#!/usr/bin/env bash
# STEP 4: Prepare for v2. Create the Firestore database and let the
# app's runtime identity read and write it.
# Run this BEFORE pushing v2, or v2's first requests will fail with
# PERMISSION_DENIED / NOT_FOUND.
set -euo pipefail
source "$(dirname "$0")/00-config.sh"

gcloud services enable firestore.googleapis.com

# The "(default)" database in Native mode, same region as Cloud Run.
# Only the default database gets Firestore's free daily quota.
gcloud firestore databases create \
  --location="$REGION" \
  --type=firestore-native || echo "Database exists, continuing"

# Least privilege: the runtime SA can use Firestore, nothing else.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/datastore.user" \
  --condition=None

echo "Firestore ready. The runtime SA can now read and write it."
