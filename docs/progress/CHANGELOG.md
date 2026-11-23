# GASTROWISE — MICROSERVICES MIGRATION CHANGELOG

## [Milestone 2.2: Docker Orchestration & Network Validation] — refactor/microservices-backend — 2026-11-20

### Infrastructure & DevOps
- **Docker Compose Optimization:**
  - `docker-compose.yml`: Removed obsolete `version: "3.9"` attribute for clean Compose v5 resolution.
  - Verified service definitions, port bindings, internal network bridges, and environment variable bindings (`docker-compose config --quiet` exit code `0`).
- **Build Context Protection:**
  - Created `.dockerignore` for `KLTN-123-GastroWise-BE` (excluding Windows `node_modules/`, `dist/`, `.git/`, test logs).
  - Created `.dockerignore` for `KLTN-123-GastroWise-AI` (excluding `__pycache__/`, `.venv/`, `.env`, datasets).
- **Documentation & Safety:**
  - Created `docs/infrastructure/MILESTONE_2_2_DOCKER_NETWORK_VALIDATION_REPORT.md`.
  - Triggered Controlled Safety Stop at Phase 5: Halted container creation before connecting to remote MongoDB Atlas cluster detected in `.env`, pending local test database configuration and Docker Desktop daemon launch.

## [Milestone 2.1: Independent Service Build Validation] — refactor/microservices-backend — 2026-11-20

### Security Fixes & Improvements
- **Anti-Corruption Layer Hardening:**
  - `apps/planning-service/src/itineraries/itineraries.service.ts`: Added explicit propagation of `UnauthorizedException` in `generateItinerary` when `AiApiClient.optimizeRoute` returns authentication errors (HTTP 401/403). Local heuristic fallback is prevented from swallowing security exceptions.
  - `apps/planning-service/src/itineraries/itineraries.service.spec.ts`: Added unit test confirming `UnauthorizedException` rethrowing behavior.
- **Fail-Fast Core AI Client:**
  - `apps/core-service/src/restaurants/restaurants.service.ts`: Enforced `INTERNAL_AI_KEY` presence in constructor with fail-fast throw. Centralized AI requests to use `this.internalAiKey` and `this.aiBaseUrl`.
  - `apps/core-service/src/reviews/reviews.service.ts`: Added `X-Internal-AI-Key` header injection to `analyzeSentiment`.
  - `apps/core-service/src/restaurants/restaurants.recommendation.spec.ts`: Configured `INTERNAL_AI_KEY` in test lifecycle.
- **Documentation:**
  - Created `docs/security/MILESTONE_1_1_CONDITIONS_RESOLUTION.md`.

## [Milestone 1: Security & Configuration Hardening] — refactor/microservices-backend — 2026-11-20

### Security & Hardening
- **Secrets Management:**
  - `docker-compose.yml`: Removed default fallbacks; enforced `${VAR:?VAR must be set}` for `JWT_SECRET`, `INTERNAL_SERVICE_KEY`, and `INTERNAL_AI_KEY`.
  - `apps/core-service/src/auth/auth.service.ts`: Removed `'gastrowise_jwt_secret'` fallback; required explicit `JWT_SECRET`.
  - `apps/planning-service/src/acl/core-api.client.ts`: Removed fallback; required `INTERNAL_SERVICE_KEY`.
  - `apps/planning-service/src/acl/ai-api.client.ts`: Required `INTERNAL_AI_KEY`.
- **Service Mesh Mutual Authentication:**
  - `libs/shared/src/guards/internal-auth.guard.ts`: Enforced server-side secret configuration check and constant-time string comparison (`crypto.timingSafeEqual`).
- **ACL Error Handling & Fault Tolerance:**
  - `apps/planning-service/src/acl/core-api.client.ts`: Differentiated 401/403, 5xx, timeouts, connection refused, and 404; structured JSON logging.
  - `apps/planning-service/src/acl/ai-api.client.ts`: Prevented silent heuristic fallback on auth failures; added structured JSON logging and correlation tracking.
- **JWT Standardization:**
  - `apps/core-service/src/auth/jwt.strategy.ts` & `apps/planning-service/src/auth/jwt.strategy.ts`: Added validation for `issuer: 'gastrowise-auth'` and `audience: 'gastrowise-api'`.
  - `apps/core-service/src/auth/auth.service.ts`: Updated `_generateTokens` to sign with standard issuer and audience.
- **Input Validation Fix:**
  - `apps/core-service/src/reviews/dto/create-review.dto.ts`: Added `class-validator` decorators.
  - `apps/core-service/src/main.ts` & `apps/planning-service/src/main.ts`: Configured `ValidationPipe({ whitelist: false, transform: true })`.
- **Test Coverage:**
  - Added `apps/planning-service/src/acl/security.spec.ts` (10 tests).
  - Added `apps/core-service/src/auth/jwt.strategy.spec.ts` (3 tests).
  - Added `apps/planning-service/src/auth/jwt.strategy.spec.ts` (3 tests).
  - Expanded `libs/shared/src/guards/internal-auth.guard.spec.ts` (5 tests).

## [Unreleased] — refactor/microservices-backend — 2026-11-20

### Added
- **NestJS Monorepo Structure:**
  - `apps/core-service`: Independent NestJS application owning identity, catalog, reviews, favorites, taste DNA, interactions, and contacts.
  - `apps/planning-service`: Independent NestJS application owning itinerary lifecycle and smart tour timetable generation.
  - `libs/shared`: Pure TypeScript library containing contracts, enums, guards, and math utilities with zero database dependencies.
- **Internal Communication Mesh:**
  - `apps/core-service/src/internal/`: Internal provider module exposing candidate venue queries, taste profile vectors, and interaction ingestion for Planning Service.
  - `libs/shared/src/guards/internal-auth.guard.ts`: Constant-time `X-Internal-Service-Key` verification guard.
  - `apps/planning-service/src/acl/`: Anti-Corruption Layer with `CoreApiClient` (REST client for Core) and `AiApiClient` (REST client for OR-Tools TSPTW route optimization with 3500ms timeout & greedy fallback).
- **API Gateway & Routing:**
  - `nginx/nginx.conf`: Nginx API Gateway listening on port 8080 with path routing, CORS headers, rate limiting, and backward-compatible route rewrites.
- **Containerization & DevOps:**
  - `apps/core-service/Dockerfile`: Multi-stage production build for Core Service.
  - `apps/planning-service/Dockerfile`: Multi-stage production build for Planning Service.
  - `docker-compose.yml`: Microservices orchestration topology.
  - `scripts/db-split-dryrun.ts`: Safe database partition validation dry-run tool.
  - `docs/DEPLOYMENT_GUIDE.md`: Comprehensive local and Docker deployment manual.
- **Security Hardening:**
  - `apps/core-service/src/reviews/reviews.controller.ts`: Enforced `JwtAuthGuard` on creation, and ownership/admin validation on `PATCH /reviews/:id` and `DELETE /reviews/:id`.
  - `apps/core-service/src/interactions/interactions.controller.ts`: Protected `GET /interactions/matrix` with `@Roles('admin')`.
  - `KLTN-123-GastroWise-AI/app/core/auth.py`: Added `X-Internal-AI-Key` timing-safe verification dependency.

### Changed
- `nest-cli.json`: Reconfigured to monorepo mode with projects `core-service`, `planning-service`, and `shared`.
- `tsconfig.json`: Added path mapping `@shared/*` pointing to `libs/shared/src/*`.
- `package.json`: Added scripts `build:core`, `build:planning`, `build:shared`, `build:all`, `start:core`, `start:planning`, `test:microservices`.
- `apps/planning-service/src/itineraries/schemas/itinerary.schema.ts`: Converted `restaurant_id` to string scalar snapshot value object; converted `user_id` to string scalar; eliminated Mongoose `populate()` cross-boundary calls.
- `apps/core-service/src/users/schemas/notification.schema.ts`: Converted `itineraryId` to scalar string to decouple from Planning DB.
- `apps/core-service/src/restaurants/restaurants.service.ts`: Corrected AI endpoint URLs from `/v1/recommendation/...` to `/recommend/hybrid`, `/cf/train`, and `/copilot/message`.
- `KLTN-123-GastroWise-AI/app/api/v1/router.py`: Added dual-route compatibility mounts for zero-downtime transition.
