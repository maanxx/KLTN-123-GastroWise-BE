# GastroWise Backend CI Setup (`KLTN-123-GastroWise-BE`)

This document describes the GitHub Actions CI pipeline for the GastroWise NestJS backend monorepo (`core-service`, `planning-service`, and `libs/shared`).

---

## 1. Workflow Inventory

| Workflow File | Name | Purpose | Modified in M10.5.3? |
|---|---|---|---|
| `.github/workflows/backend-ci.yml` | **Backend CI** | Automated build, typecheck, lint report, unit/microservices tests, git hygiene, and Python utility syntax check | **Added** |
| `.github/workflows/mongodb-scheduled-backup.yml` | Scheduled MongoDB Encrypted Backup | Daily encrypted `mongodump` to WORM S3 (`production-backup` environment) | Untouched |
| `.github/workflows/mongodb-weekly-restore-drill.yml` | Weekly MongoDB Restore Verification Drill | Weekly ephemeral MongoDB 7.0 restore verification (`backup-verification` environment) | Untouched |

---

## 2. Trigger Conditions (`backend-ci.yml`)

The Backend CI workflow runs automatically on:

- **Pull requests targeting `main`** (`pull_request.branches: [main]`)
- **Pushes to `main`** (`push.branches: [main]`)
- **Pushes to feature, fix, and refactor branches:**
  - `feat/**`
  - `feature/**`
  - `fix/**`
  - `refactor/**`

Superseded runs on non-`main` branches are cancelled automatically via `concurrency`.

---

## 3. Runtime Versions & Safety Guarantees

- **Node.js `24`:** Matches `FROM node:24-alpine` in `apps/core-service/Dockerfile` and `apps/planning-service/Dockerfile`.
- **Python `3.12`:** Used only to syntax-check tracked utility scripts (`crawl_shopeefood.py`, `probe_crawler.py`) via `python3 -m py_compile`. The FastAPI AI Service lives in its own repository (`KLTN-123-GastroWise-AI`).
- **Database & Secret Isolation:**
  - Uses least-privilege `permissions: contents: read`.
  - References **zero** GitHub Actions secrets (`secrets.*`) and no deployment environments.
  - Injects isolated local-only test values (`NODE_ENV=test`, `mongodb://127.0.0.1:27017/gastro_*_test`, dummy test keys, `GASTROWISE_ALLOW_LOCAL_INGESTION=false`).
  - Never connects to MongoDB Atlas or production databases.
  - Never runs database migrations (`migrate:up` / `migrate:down`) or mutating ingestion scripts.

---

## 4. Jobs & Commands

### Job 1: `backend-quality`
| Step | Command | Enforcement |
|---|---|---|
| Git diff hygiene | `git diff --check` (+ base-to-HEAD range check) | **Blocking** |
| Dependency install | `npm ci --no-audit --no-fund` | **Blocking** |
| ESLint check | `npx eslint "{src,apps,libs,test}/**/*.ts"` | **Advisory** (`continue-on-error: true`, summary published to `$GITHUB_STEP_SUMMARY`) |
| TypeScript check | `npx tsc -p tsconfig.build.json --noEmit` | **Blocking** |
| Build all services | `npm run build:shared` && `npm run build:all` | **Blocking** |
| Microservices tests | `npm run test:microservices` (`jest libs/ apps/`) | **Blocking** |

> **Why ESLint is currently advisory:** The repository currently has pre-existing legacy lint errors across older NestJS modules (`@typescript-eslint/no-unsafe-*` and Prettier formatting). Running ESLint without `--fix` as an advisory step surfaces exact counts in every CI run without blocking unrelated PRs while legacy lint debt is paid down. Once legacy errors are resolved, `continue-on-error: true` should be removed to make ESLint strictly blocking.

### Job 2: `python-utility-check`
| Step | Command | Enforcement |
|---|---|---|
| Python syntax check | `python3 -m py_compile $(git ls-files '*.py')` | **Blocking** |

---

## 5. Running the Exact CI Checks Locally

Run the same checks locally before pushing:

```bash
# 1. Whitespace & conflict marker check
git diff --check

# 2. TypeScript compilation
npx tsc -p tsconfig.build.json --noEmit

# 3. Build shared lib + core-service + planning-service
npm run build:shared && npm run build:all

# 4. Run all microservices unit & integration tests (isolated, mocked DB)
npm run test:microservices

# 5. ESLint (read-only check; do not use --fix in CI)
npx eslint "{src,apps,libs,test}/**/*.ts"

# 6. Python utility syntax check
python3 -m py_compile crawl_shopeefood.py probe_crawler.py
```
