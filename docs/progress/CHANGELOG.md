# GASTROWISE — MICROSERVICES MIGRATION CHANGELOG

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
