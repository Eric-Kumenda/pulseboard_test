#!/usr/bin/env bash
# STEP 2: Create an Artifact Registry repo, build the image, push it.
set -euo pipefail
source "$(dirname "$0")/00-config.sh"

# 2a. A Docker repository to hold our images.
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --description="PulseBoard images" || echo "Repository exists, continuing"

# Keep storage (and cost) small: delete all but the 5 newest versions.
cat > /tmp/cleanup-policy.json <<'JSON'
[
  { "name": "keep-5-newest", "action": { "type": "Keep" },
    "mostRecentVersions": { "keepCount": 5 } },
  { "name": "delete-older", "action": { "type": "Delete" },
    "condition": { "tagState": "any", "olderThan": "1d" } }
]
JSON
gcloud artifacts repositories set-cleanup-policies "$REPO" \
  --location="$REGION" --policy=/tmp/cleanup-policy.json

# 2b. Let Docker push to Artifact Registry with your gcloud login.
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# 2c. Build locally (Cloud Shell has Docker) and push.
TAG="v1-$(date +%H%M%S)"
docker build -t "${IMAGE}:${TAG}" -t "${IMAGE}:latest" .
docker push --all-tags "$IMAGE"
echo "$TAG" > /tmp/pulseboard-tag

# Alternative with no local Docker: let Cloud Build do it.
#   gcloud builds submit --tag "${IMAGE}:${TAG}" .

echo "Pushed ${IMAGE}:${TAG}"
gcloud artifacts docker images list "$IMAGE" --include-tags --limit=5
