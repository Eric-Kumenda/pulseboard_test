#!/usr/bin/env bash
# STEP 1: Create the project, link billing, set a budget, enable APIs.
# (In the session we do the project + billing part in the Console first,
#  then show these commands as the "repeatable" version.)
set -euo pipefail
source "$(dirname "$0")/00-config.sh"

# 1a. Create the project (skip if you made it in the Console).
gcloud projects create "$PROJECT_ID" --name="PulseBoard Demo" || echo "Project exists, continuing"
gcloud config set project "$PROJECT_ID"

# 1b. Link a billing account. List yours, then link one.
gcloud billing accounts list
BILLING_ACCOUNT="${BILLING_ACCOUNT:?Set BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX from the list above}"
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"

# 1c. Budget alert BEFORE we build anything.
#     Emails billing admins at 50%, 90% and 100% of the amount.
#     The amount uses your billing account's currency (e.g. 10USD or 1300KES).
gcloud services enable billingbudgets.googleapis.com
gcloud billing budgets create \
  --billing-account="$BILLING_ACCOUNT" \
  --display-name="PulseBoard demo budget" \
  --budget-amount="${BUDGET_AMOUNT:-10}" \
  --filter-projects="projects/${PROJECT_ID}" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0

# 1d. Turn on the services we need.
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com

echo "Project ready. Billing linked, budget set, APIs enabled."
