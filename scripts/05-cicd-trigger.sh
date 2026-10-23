#!/usr/bin/env bash
# STEP 5: Continuous deployment. Every push to main on GitHub runs
# cloudbuild.yaml: test -> build -> push -> deploy.
#
# In the live session we click through this in the Console
# (Cloud Build > Repositories > 2nd gen, then Triggers). These commands
# are the scripted equivalent for after the session.
set -euo pipefail
source "$(dirname "$0")/00-config.sh"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

gcloud services enable cloudbuild.googleapis.com secretmanager.googleapis.com

# ---------------------------------------------------------------
# 5a. A dedicated service account for the trigger's builds.
#     New projects must name a service account on every trigger.
# ---------------------------------------------------------------
gcloud iam service-accounts create pulseboard-deployer \
  --display-name="PulseBoard Cloud Build deployer" || echo "Deployer SA exists, continuing"

for ROLE in \
  roles/run.admin \
  roles/artifactregistry.writer \
  roles/logging.logWriter \
  roles/cloudbuild.builds.builder; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${DEPLOYER_SA}" --role="$ROLE" --condition=None >/dev/null
  echo "granted $ROLE"
done

# The deployer must be allowed to "act as" the runtime SA, because each
# deploy attaches pulseboard-run to the new revision.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:${DEPLOYER_SA}" \
  --role="roles/iam.serviceAccountUser"

# ---------------------------------------------------------------
# 5b. Connect GitHub (2nd gen repositories).
#     This prints a link: open it, authorise the Cloud Build GitHub App
#     and install it on your account (pick just the pulseboard repo).
# ---------------------------------------------------------------
gcloud builds connections create github "$CONNECTION" --region="$REGION" || true
echo "Finish the browser step, then press Enter."; read -r
gcloud builds connections describe "$CONNECTION" --region="$REGION" \
  --format='value(installationState.stage)'   # want: COMPLETE

gcloud builds repositories create pulseboard \
  --remote-uri="$GITHUB_REPO_URL" \
  --connection="$CONNECTION" --region="$REGION" || echo "Repository link exists, continuing"

# ---------------------------------------------------------------
# 5c. The trigger: push to main -> run cloudbuild.yaml as the deployer.
# ---------------------------------------------------------------
gcloud builds triggers create github \
  --name=pulseboard-main \
  --region="$REGION" \
  --repository="projects/${PROJECT_ID}/locations/${REGION}/connections/${CONNECTION}/repositories/pulseboard" \
  --branch-pattern='^main$' \
  --build-config=cloudbuild.yaml \
  --service-account="projects/${PROJECT_ID}/serviceAccounts/${DEPLOYER_SA}" \
  --substitutions="_REGION=${REGION},_SERVICE=${SERVICE},_REPO=${REPO}"

echo
echo "Trigger created. Test it without a commit:"
echo "  gcloud builds triggers run pulseboard-main --region=$REGION --branch=main"
echo "Then watch:  gcloud builds list --region=$REGION --limit=3"
