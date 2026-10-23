#!/usr/bin/env bash
# STEP 3: Deploy v1 to Cloud Run, with cost guardrails.
set -euo pipefail
source "$(dirname "$0")/00-config.sh"
TAG="$(cat /tmp/pulseboard-tag 2>/dev/null || echo latest)"

# 3a. A dedicated identity for the running app (not the default
#     Compute Engine account, which can have far more access than needed).
gcloud iam service-accounts create pulseboard-run \
  --display-name="PulseBoard runtime" || echo "Runtime SA exists, continuing"

# 3b. Deploy.
gcloud run deploy "$SERVICE" \
  --image="${IMAGE}:${TAG}" \
  --region="$REGION" \
  --service-account="$RUNTIME_SA" \
  --allow-unauthenticated \
  --cpu=1 --memory=512Mi \
  --concurrency=10 \
  --min-instances=0 \
  --max-instances=5 \
  --timeout=30s \
  --set-env-vars="ADMIN_KEY=${ADMIN_KEY}"

#  What these flags mean:
#   --allow-unauthenticated  anyone with the URL can open it (it's a public web app)
#   --concurrency=10         one instance handles at most 10 requests at once.
#                            Kept LOW on purpose so a room of ~40 phones makes
#                            Cloud Run add instances we can watch. (Default is 80.)
#   --min-instances=0        scale to zero when nobody is using it: no idle cost
#   --max-instances=5        hard ceiling on instances = a ceiling on cost
#   --timeout=30s            no request may run longer than 30 seconds

URL="$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"
echo
echo "Attendees:  $URL"
echo "Projector:  $URL/board?key=$ADMIN_KEY"
curl -s "$URL/healthz"; echo
