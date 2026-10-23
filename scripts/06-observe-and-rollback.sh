#!/usr/bin/env bash
# STEP 6: Handy commands for the "what just happened?" part of the demo.
# Run them one at a time; this file is a menu, not a pipeline.
source "$(dirname "$0")/00-config.sh"

# Which revisions exist, and who gets the traffic?
gcloud run revisions list --service="$SERVICE" --region="$REGION"

# The last few builds from the trigger.
gcloud builds list --region="$REGION" --limit=5

# Live logs from the service (Ctrl+C to stop). Needs the beta component,
# which Cloud Shell already has. Without it: gcloud run services logs read
gcloud beta run services logs tail "$SERVICE" --region="$REGION"

# Only errors from the last hour, via Cloud Logging.
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE AND severity>=ERROR" \
  --freshness=1h --limit=20

# CANARY: send 10% of traffic to the newest revision, 90% to the previous one.
#   NEW=$(gcloud run revisions list --service=$SERVICE --region=$REGION --format='value(name)' --limit=1)
#   OLD=<previous revision name from the list above>
#   gcloud run services update-traffic "$SERVICE" --region="$REGION" --to-revisions="$NEW=10,$OLD=90"

# ROLLBACK in one line: all traffic back to a known-good revision.
#   gcloud run services update-traffic "$SERVICE" --region="$REGION" --to-revisions="$OLD=100"

# Back to "newest revision gets everything" (what the trigger expects).
#   gcloud run services update-traffic "$SERVICE" --region="$REGION" --to-latest
