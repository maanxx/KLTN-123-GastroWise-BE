# M8.5 — GastroWise Incident Response Runbook & Failure Scenarios

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Companion Docs:** [`M8_5_DISASTER_RECOVERY_PLAN.md`](./M8_5_DISASTER_RECOVERY_PLAN.md), [`M8_4_RESTORE_RUNBOOK.md`](./M8_4_RESTORE_RUNBOOK.md), [`M8_3_MIGRATION_STRATEGY.md`](./M8_3_MIGRATION_STRATEGY.md)

---

## 1. Incident Severity Matrix (M8.5.1 — Proposed Roles)

*Note: GastroWise currently has no live on-call rotation; assigned technical roles below are **proposed** operational responsibilities.*

| Level | Trigger Conditions | Business Impact | Response Priority | Proposed Owner & Escalation | Recovery Expectation (Align M8.4 RTO/RPO) |
|---|---|---|---|---|---|
| **SEV-1** (Critical) | Complete `gastro_core` or `gastro_planning` outage; widespread data corruption/loss; leaked secrets/`INTERNAL_AI_KEY`; failed migration corrupting Tier-1 tables | Platform-wide login, catalog, or itinerary failure; active data loss risk | **Immediate (`P0`)** | **Proposed Lead:** Tech Lead + Database Engineer (+ DevOps/SRE). Immediate escalation to all engineers. | **RTO:** `<= 30–45 min` (`Tier-1`)<br/>**RPO:** `<= 5 min` (PITR) / `<= 6h` (logical) |
| **SEV-2** (Major) | `core-service` or `planning-service` crash/OOM; sustained `5xx > 5%`; partial DB slowdown (`COLLSCAN` lockups) | Core discovery or tour creation severely degraded or unavailable | **High (`P1` < 15 min)** | **Proposed Lead:** Backend Engineer + DevOps/SRE. Escalate to Tech Lead if unresolved in 30 min. | **RTO:** `<= 60 min` |
| **SEV-3** (Partial) | `ai-service` down (Core/Planning fallbacks active); `reviews`/`sentiment` delayed; non-critical collection failure (`contacts`) | AI-personalized ranking & OR-Tools degrade to DB regex / greedy heuristic | **Medium (`P2` < 2h)** | **Proposed Lead:** Backend / AI Engineer. Log issue for same-day triage. | Restore full AI quality within `<= 2–4 hours` |
| **SEV-4** (Minor) | Single non-blocking warning, test-env failure, stale telemetry sync (`/cf/train`) | Minimal or zero user-facing impact | **Low (`P3` Next business day)** | **Proposed Lead:** Assigned feature developer | Standard PR fix cycle |

---

## 2. Standardized 9-Step Incident Response Workflow (M8.5.2)

1. **Detection:** Triggered via Nginx `502`/`504` access logs, structured JSON error logs (`X-Correlation-Id`), container health failures (`docker ps` / orchestrator), or user report *(proposed: automated Prometheus/uptime alert webhooks)*.
2. **Initial Assessment:** Verify `/health` across `nginx-gateway`, `core-service`, `planning-service`, and `ai-service` (`GET /`); sample recent logs matching failing `X-Correlation-Id`.
3. **Incident Classification:** Assign `SEV-1` to `SEV-4` using Section 1 criteria; open incident log with UTC timestamp `T_start`.
4. **Containment:** For DB corruption/migration/deletion incidents, halt writes immediately (maintenance response at `nginx-gateway` or stop offending worker/migration script). **Preserve damaged state/logs for forensics before modifying anything.**
5. **Root Cause Investigation:** Correlate failing `X-Correlation-Id`, recent git deploys, `schema_migrations` status, or Atlas metrics without touching production credentials.
6. **Recovery:** Follow the scenario procedure in Section 3 (delegating backup/restore execution strictly to [`M8_4_RESTORE_RUNBOOK.md`](./M8_4_RESTORE_RUNBOOK.md)).
7. **Data Integrity Verification:** Execute [`M8_4_RECOVERY_VALIDATION.md`](./M8_4_RECOVERY_VALIDATION.md) Phases B–E (`countDocuments`, indexes, orphan/UTF-8 sampling, Core/Planning/AI smoke tests).
8. **Service Restoration:** Bring services back in Priority 0 → 3 order ([`M8_5_DISASTER_RECOVERY_PLAN.md`](./M8_5_DISASTER_RECOVERY_PLAN.md) Section 3.2), verify `restaurants_loaded > 0` in AI, and clear maintenance mode.
9. **Post-Incident Review:** Publish blameless postmortem (Section 4) within 48 hours and schedule M8/backlog prevention tasks.

**Proposed Role Responsibilities:**
- **Backend Engineer:** Trace NestJS/FastAPI logs via `X-Correlation-Id`, deploy hotfixes/rollbacks, verify API smoke tests & fallback integrity.
- **Database Engineer:** Assess `gastro_core` / `gastro_planning` damage, execute [`M8_4_RESTORE_RUNBOOK.md`](./M8_4_RESTORE_RUNBOOK.md) & M8.3 rollback scripts, verify counts/indexes.
- **DevOps / SRE:** Gate `nginx-gateway` traffic, inspect container/cluster resources, rotate compromised secrets, verify TLS & isolated restore sandboxes.
- **Tech Lead:** Confirm `SEV-1` declaration, approve destructive `--drop`/PITR cutovers, coordinate cross-service recovery, lead blameless postmortem.

---

## 3. GastroWise Disaster Recovery Scenarios (M8.5.3)

| # | Scenario | Detection Signals | Potential Impact | Immediate Containment | Recovery & Reference | Integrity Checks & Escalation | Prevention Strategy |
|---|---|---|---|---|---|---|---|
| **1** | **MongoDB Unavailable** | `MongooseServerSelectionError`, `500`/`503` on Core/Planning, `mongo` ping fails | Full Core & Planning write/read outage; AI retains stale RAM | Put Nginx in maintenance for writes; check Atlas status / Docker container | Restart DB or allow Atlas Replica Set election; reload `ai-service` once DB recovers (`M8_4` Scenario 1 if volume lost) | Verify `/health` + Core/Planning read/write & AI `restaurants_loaded`; Escalate `SEV-1` | Atlas M10+ Replica Set + `/health/ready` DB readiness probe |
| **2** | **Database Corruption** | BSON decode errors, mass invalid GeoJSON/rating values, broken UTF-8 | Corrupted responses across Mobile/FE & AI recommendations | **Freeze writers immediately** (`nginx` write block); take forensic `mongodump` | Execute [`M8_4_RESTORE_RUNBOOK.md`](./M8_4_RESTORE_RUNBOOK.md) Scenario 5 (`T_clean` full/namespace restore + AI restart) | Run `M8_4_RECOVERY_VALIDATION` Phases C–D (`countDocuments`, schema sampling); `SEV-1` Tech Lead sign-off | Typed Mongoose validators (`min`/`max`/enums) + pre-migration dry-runs |
| **3** | **Accidental Data Deletion** | Missing restaurant/user/itinerary `404` reports; unexpected `countDocuments()` drop | Loss of critical catalog or user itineraries | Capture audit logs & pinpoint `T_incident`; **never run `--drop` live** | Execute [`M8_4_RESTORE_RUNBOOK.md`](./M8_4_RESTORE_RUNBOOK.md) Scenario 3 (isolated `restore_staging` extract) or Scenario 6 (PITR) | Recompute `restaurants` rating aggregates if `reviews` affected; `SEV-1`/`SEV-2` escalation | Soft-delete (`deletedAt`/archived flag) for Tier-1 models + RBAC admin confirmation |
| **4** | **Failed Schema Migration** | Migration runner non-zero exit, `E11000`, latency `> 3x`, `schema_migrations` `failed` state | Partial transformed docs; broken queries or auth errors | Stop runner immediately; check abort criteria in [`M8_3_MIGRATION_STRATEGY.md`](./M8_3_MIGRATION_STRATEGY.md) | Execute [`M8_4_RESTORE_RUNBOOK.md`](./M8_4_RESTORE_RUNBOOK.md) Scenario 4 (`down()` rollback, `dropIndex`, or pinned pre-migration snapshot restore) | Verify `schema_migrations`, doc parity, and `explain('executionStats')`; `SEV-1` if Tier-1 mutated | Staging dry-run (`M8_3` checklist) + idempotent Expand–Contract waves |
| **5** | **Backend Microservice Outage** | Nginx `502`/`504`, `max_fails=3` upstream trips, container exit code `!= 0` | Core outage breaks login/catalog; Planning outage breaks tours | Isolate failing logs (`docker logs`), keep healthy peer services online | Restart container via orchestrator; verify MongoDB & env vars (`INTERNAL_AI_KEY`, `JWT_SECRET`); rollback bad image | Run Core/Planning `/health` + CRUD smoke check; `SEV-2` escalation | Graceful shutdown handlers + `/health/ready` probe + automated multi-replica |
| **6** | **Inter-Service Comm Failure** | `CoreApiClient`/`AiApiClient` `ECONNABORTED`/`ECONNREFUSED`, HTTP `401`/`403`, circuit-breaker fallback logs | Planning degrades to Greedy Heuristic; Core search degrades to Mongo regex (or fails on `401`/`403`) | Check DNS (`core-service:3001`, `ai-service:5000`), verify mismatched `INTERNAL_*_KEY` | Restart stalled service or re-inject aligned secrets (`401`/`403` never auto-fallback) | Test `GET /internal/restaurants/candidates` & `POST /routes/optimize` with `X-Correlation-Id`; `SEV-2`/`SEV-3` | M7.3 contract CI tests + consistent startup fail-fast secret checks |
| **7** | **Infrastructure / Container Failure** | Host/Docker daemon unreachable, disk full, OOM kill (`Exit 137`) on PyTorch/YOLO AI | Total container outage on host node | Free disk / migrate containers to healthy host | Recreate containers via Compose/orchestrator; restore Mongo volumes via [`M8_4_RESTORE_RUNBOOK.md`](./M8_4_RESTORE_RUNBOOK.md) Scenario 1 if local disk lost | Verify all 5 container health checks + persistent DB counts; `SEV-1` | Externalize DB (Atlas) & logs off host; configure container memory limits |
| **8** | **Credential Compromise** | Suspected leak of `MONGODB_URI*`, `JWT_SECRET`, `INTERNAL_SERVICE_KEY`, or `INTERNAL_AI_KEY` | Unauthorized DB read/write or forged service/user JWTs | **Rotate compromised keys immediately** (`MongoDB` password, `JWT_SECRET`, internal keys); audit Atlas access logs | Inject rotated secrets cleanly across Core, Planning, and AI simultaneously; clear `User.hashedRefreshToken` to invalidate refresh sessions | Verify rejected old keys (`401`/`403`) + valid new keys (`200`); `SEV-1` Security incident | Pre-commit secret scanning + Vault/GitHub Secrets + least-privilege DB roles |
| **9** | **Backup Storage Unavailable** | Daily `mongodump` upload `503`/auth failure; object-store region outage | RPO degradation if outage persists; **live DB unaffected** | Alert DevOps/SRE; **block all risky M8.3+ migrations immediately** | Re-run local encrypted dump to secondary region/bucket; verify Atlas Cloud Snapshot health | Re-run `M8_4_RECOVERY_VALIDATION` Phase A (`sha256sum`, `--dryRun`); `SEV-3` (escalate to `SEV-2` if >24h) | Dual-region replication + daily backup monitor check before migrations |

---

## 4. Blameless Post-Incident Review Template (M8.5.7)

```markdown
# Post-Incident Review: [INC-YYYY-NNN] <Short Title>
- **Severity:** SEV-1 / SEV-2 / SEV-3 / SEV-4
- **Date & Duration:** YYYY-MM-DD HH:MM UTC to HH:MM UTC (Total Duration: X min | Measured RTO: Y min | Data Loss / RPO: Z min)
- **Proposed Incident Roles:** Tech Lead: <name> | DB Engineer: <name> | Backend: <name> | SRE: <name>

## 1. Incident Summary
Concise description of what failed, impacted services (`core-service`, `planning-service`, `ai-service`, MongoDB), and resolution.

## 2. Customer & Business Impact
- Affected endpoints / features & estimated % failed requests.
- Any confirmed data loss or stale state duration.

## 3. Detailed Timeline (UTC, with `X-Correlation-Id` references)
- `HH:MM` — Trigger event / deployment / migration.
- `HH:MM` — Detection signal observed.
- `HH:MM` — Containment applied.
- `HH:MM` — Recovery started (`M8_4` scenario #) and verified (`M8_4` validation).
- `HH:MM` — Full service restored.

## 4. Root Cause Analysis (5 Whys)
Technical root cause without blaming individuals.

## 5. Detection & Response Effectiveness
- What worked well?
- Where did detection, health checks, fallbacks, or runbooks lag?

## 6. Preventive Action Items
| ID | Action | Priority | Responsible Owner | Target Milestone / Due Date |
|---|---|---|---|---|
| AI-01 | <Specific engineering/DB fix> | P0/P1/P2 | <Role / Name> | <Date> |
```
