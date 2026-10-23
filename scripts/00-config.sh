#!/usr/bin/env bash
# Session settings. Load into your shell with:  source scripts/00-config.sh
# Run everything from Cloud Shell (it already has gcloud, docker, git and node).

# A globally unique project ID: lowercase letters, digits, hyphens, 6-30 chars.
export PROJECT_ID="${PROJECT_ID:-pulseboard-gdgoc-uon}"

# One region for everything. europe-west1 is a Tier 1 price region and
# supports Cloud Run, Artifact Registry, Cloud Build and Firestore.
export REGION="${REGION:-europe-west1}"

export SERVICE="pulseboard"
export REPO="pulseboard"
export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}"

# Two service accounts, each with only the permissions it needs:
export RUNTIME_SA="pulseboard-run@${PROJECT_ID}.iam.gserviceaccount.com"      # the running app
export DEPLOYER_SA="pulseboard-deployer@${PROJECT_ID}.iam.gserviceaccount.com" # Cloud Build trigger

# Presenter key for /board?key=... (change it before the session!)
export ADMIN_KEY="${ADMIN_KEY:-change-me-$(date +%m%d)}"

# GitHub repo that holds this code, e.g. https://github.com/you/pulseboard.git
export GITHUB_REPO_URL="${GITHUB_REPO_URL:-https://github.com/YOUR_USER/pulseboard.git}"
export CONNECTION="github-conn"

gcloud config set project "$PROJECT_ID" >/dev/null 2>&1 || true
gcloud config set run/region "$REGION" >/dev/null 2>&1 || true

echo "PROJECT_ID=$PROJECT_ID  REGION=$REGION  IMAGE=$IMAGE"
