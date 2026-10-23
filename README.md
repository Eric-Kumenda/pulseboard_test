# PulseBoard

Live polls, Q&A and emoji reactions for a room full of people, built as a
hands-on **Google Cloud Run** demo for beginners.

Every response is stamped with the **container instance** and **revision**
that served it, so the room can *see* Cloud Run scale out, scale to zero,
and roll out a new version.

| Page | Who uses it |
|---|---|
| `/` | Attendees, on their phones (scan the QR code) |
| `/board` | The projector. Add `?key=ADMIN_KEY` for presenter controls (◀ ▶ polls, hide questions) |
| `/healthz` | Health check |

## Two versions, one lesson

| | v1 (`main` at tag `v1`) | v2 (branch `v2-firestore`, tag `v2`) |
|---|---|---|
| State lives in | Each container's memory | Firestore |
| With 1 instance | Works | Works |
| With 3 instances | **Broken on purpose**: every instance has its own vote totals, questions "disappear" | Works: every instance reads the same data |
| What changes | n/a | `src/store.js`, `package.json` only |

The lesson: **Cloud Run containers must be stateless.** Keep state in a
database (Firestore, Cloud SQL, Memorystore), never in a variable.

## Run it locally

```bash
npm install
npm start                      # http://localhost:8080 and /board?key=pulseboard
npm test
```

Rehearse with a fake crowd (works against local or deployed URLs):

```bash
node tools/crowd.js https://YOUR-SERVICE-URL --users 60 --seconds 45
```

## Session runbook

Everything runs from **Cloud Shell**. Each script is commented line by line.

| Step | Script | What happens |
|---|---|---|
| 0 | `source scripts/00-config.sh` | Project ID, region, names |
| 1 | `scripts/01-project-and-billing.sh` | Project, billing link, **budget alert**, enable APIs |
| 2 | `scripts/02-registry-build-push.sh` | Artifact Registry + cleanup policy, `docker build`, `docker push` |
| 3 | `scripts/03-deploy-v1.sh` | `gcloud run deploy` with cost guardrails. Room joins, scaling, the bug |
| 4 | `scripts/04-firestore.sh` | Firestore database + IAM for the runtime identity |
| 5 | `scripts/05-cicd-trigger.sh` | Deployer identity, GitHub connection, trigger on `main` |
| 6 | `git merge v2-firestore && git push` | Trigger builds and deploys v2, replacing v1 |
| 7 | `scripts/06-observe-and-rollback.sh` | Revisions, logs, canary, rollback |
| 99 | `scripts/99-teardown.sh` | Stop all charges |

### The v2 rollout (the CI/CD moment)

```bash
git checkout main
git merge v2-firestore  # brings in the Firestore store
git push origin main    # Cloud Build trigger fires
```

Watch **Cloud Build > History**: `test → build → push → deploy`. When it
finishes, the board's chip changes from `v1.0.0 · storage: memory` to
`v2.0.0 · storage: firestore`, the revision number goes up by one, and the
"Heads up" warning disappears even with several instances.

## Architecture

```
Phones / projector ──HTTPS──▶ Cloud Run service "pulseboard"
                                 │  instances 0..5 (autoscaled)
                                 ├─ v1: state in memory (per instance)
                                 └─ v2: state in Firestore (shared)

git push ─▶ GitHub ─▶ Cloud Build trigger ─▶ test, build, push
                                             │
                     Artifact Registry ◀─────┘ ─▶ gcloud run deploy (new revision)
```

## Cost guardrails used in this demo

* Budget with alerts at 50/90/100%, created **before** anything else.
  A budget **alerts**; it does not stop spending.
* `--min-instances=0` (scale to zero), `--max-instances=5` (cost ceiling).
* Request-based billing: you pay only while a request is being handled.
* Artifact Registry cleanup policy keeps only the newest images.
* Firestore real-time listeners instead of polling the database, so reads
  scale with **changes**, not with the number of phones.
* Teardown script, or simply delete the project.

## Project layout

```
server.js            Express app + routes
src/identity.js      Which instance / revision am I?
src/store.js         v1: memory   |   v2: Firestore  (same functions)
polls.json           The questions shown on the board
public/              Attendee page, board, styles
tools/crowd.js       Load / crowd simulator
test/                Store contract tests
Dockerfile           Container recipe
cloudbuild.yaml      CI/CD pipeline used by the trigger
scripts/             Numbered session scripts
```
