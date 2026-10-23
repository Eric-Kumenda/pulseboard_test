#!/usr/bin/env bash
# STEP 99: Stop all charges after the session.
#
# Option A (simplest, recommended for attendees): delete the whole project.
#   Everything in it stops billing immediately. The project ID can't be
#   reused, and the project can be restored within 30 days.
#     gcloud projects delete "$PROJECT_ID"
#
# Option B: keep the project, delete the paid pieces one by one (below).
set -uo pipefail
source "$(dirname "$0")/00-config.sh"

gcloud run services delete "$SERVICE" --region="$REGION" --quiet
gcloud builds triggers delete pulseboard-main --region="$REGION" --quiet
gcloud artifacts repositories delete "$REPO" --location="$REGION" --quiet

# Firestore: delete the database (data is gone for good).
gcloud firestore databases delete --database='(default)' --quiet

echo "Done. Check Billing > Reports tomorrow: the line should be flat."
