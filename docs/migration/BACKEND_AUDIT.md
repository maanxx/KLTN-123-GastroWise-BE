# GASTROWISE – BACKEND COMPREHENSIVE ARCHITECTURE AUDIT (CURRENT STATE)

**Document:** `docs/migration/BACKEND_AUDIT.md`  
**Repository:** [KLTN-123-GastroWise-BE](https://github.com/maanxx/KLTN-123-GastroWise-BE) (Commit: `f6bc66f`)  
**GitHub Issue:** [#9 - Migrate Modular Monolith to Microservices Architecture](https://github.com/maanxx/KLTN-123-GastroWise-BE/issues/9)  
**Author:** Senior Software Architect & Backend Tech Lead  
**Audit Date:** November 20, 2026  
**Status:** 100% EVIDENCE-BASED AUDIT — ZERO SOURCE CODE MODIFIED  

---

## 1. REPOSITORY & RUNTIME INVENTORY

### 1.1. Host & Engine Specification
- **Host Runtime:** Node.js `v24.19.0`, npm `11.11.0`
- **Framework Core:** `@nestjs/core` `^11.0.1`, `@nestjs/common` `^11.0.1`, `@nestjs/platform-express` `^11.0.1`
- **ORM / ODM:** `mongoose` `^8.13.1`, `@nestjs/mongoose` `^11.0.1`
- **Authentication & Security:** `@nestjs/jwt` `^11.0.0`, `@nestjs/passport` `^11.0.0`, `passport-jwt` `^4.0.1`, `passport-google-oauth20` `^2.0.0`, `bcrypt` `^6.0.0`, `otplib` `^12.0.1`, `qrcode` `^1.5.4`
- **Inter-Service HTTP Client:** `@nestjs/axios` `^4.0.0`, `axios` `^1.8.4`
- **Validation:** `class-validator` `^0.14.1`, `class-transformer` `^0.5.1`
- **External AI SDK:** `@google/generative-ai` `^0.24.1`
- **Containerization Status:** **NONE** (Zero Dockerfiles or `docker-compose.yml` present in repository root)

### 1.2. Application Directory Structure
```text
KLTN-123-GastroWise-BE/
├── dist/                          # Compiled JS output
├── docs/                          # Architecture, migration and progress specifications
├── scripts/                       # Migration and operational maintenance scripts
├── src/
│   ├── app.controller.ts          # Root probe (GET /)
│   ├── app.module.ts              # Root composition module (MongooseModule.forRoot)
│   ├── app.service.ts
│   ├── main.ts                    # Bootstrap entrypoint (Port 3001, CORS, static /uploads)
│   ├── auth/                      # 14 endpoints: JWT, Google OAuth2, 2FA TOTP, Refresh Tokens
│   ├── contacts/                  # 4 endpoints: Inquiries, contact forms, status tracking
│   ├── favorites/                 # 3 endpoints: Bookmarked restaurants, toggle, top saved
│   ├── interactions/              # 5 endpoints: Behavioral analytics, dwell time, matrix export
│   ├── itineraries/               # 10 endpoints: Tour generation, stops, recalculation, reordering
│   ├── restaurants/               # 16 endpoints: Venue catalog, menu items, AI chat, search-by-image
│   ├── reviews/                   # 8 endpoints: Community reviews, sentiment rating, sentiment migration
│   ├── taste-dna/                 # 4 endpoints: 6-D flavor profiles, quiz, calibration
│   └── users/                     # 5 endpoints: User CRUD, RBAC roles, audit logs, notifications
└── test/                          # E2E test configuration
```

---

## 2. MODULAR MONOLITH COMPONENT AUDIT

The backend currently runs as a single Node.js process containing **10 NestJS modules**, exposing **70 concrete REST endpoints**, and managing **13 Mongoose schemas** connecting to a single MongoDB Atlas database (`gastrowise`).

### 2.1. Module & Controller Matrix

| Module Name | Controller File | Endpoints Count | Primary Bounded Context Responsibility | Target Service |
| :--- | :--- | :---: | :--- | :---: |
| **`AuthModule`** | `src/auth/auth.controller.ts` | 14 | Identity, JWT issue/refresh, 2FA, Google OAuth2 | **Core Service** |
| **`UsersModule`** | `src/users/users.controller.ts` | 5 | User profiles, Admin RBAC, avatar management | **Core Service** |
| **`RestaurantsModule`** | `src/restaurants/restaurants.controller.ts` | 16 | Venue catalog, Geospatial search, Menu CRUD, Dish search | **Core Service** |
| **`ReviewsModule`** | `src/reviews/reviews.controller.ts` | 8 | Community ratings, ViSoBERT sentiment classification | **Core Service** |
| **`FavoritesModule`** | `src/favorites/favorites.controller.ts` | 3 | User favorite bookmarks and collections | **Core Service** |
| **`TasteDnaModule`** | `src/taste-dna/taste-dna.controller.ts` | 4 | 6-D vector Taste DNA profiles, quiz scoring | **Core Service** |
| **`InteractionsModule`** | `src/interactions/interactions.controller.ts` | 5 | Behavioral telemetry (view, click, dwell, matrix export) | **Core Service** |
| **`ContactsModule`** | `src/contacts/contacts.controller.ts` | 4 | Contact submissions and inquiry workflows | **Core Service** |
| **`ItinerariesModule`** | `src/itineraries/itineraries.controller.ts` | 10 | Tour planning, timetable generation, stop optimization | **Planning Service** |
| **`AppModule`** | `src/app.controller.ts` | 1 | Global health ping (`GET /`) | **Gateway / Shared** |

---

## 3. DATABASE SCHEMA & DATA MODEL INVENTORY

The monolithic database `gastrowise` holds 11 collections defined by 13 Mongoose `@Schema()` classes:

| Schema Class | Collection Name | Defined File | Cross-Collection References (`ref`) | Service Boundary |
| :--- | :--- | :--- | :--- | :---: |
| **`User`** | `users` | `src/users/schemas/user.schema.ts` | None | **Core** |
| **`Restaurant`** | `restaurants` | `src/restaurants/schemas/restaurant.schema.ts` | `User` | **Core** |
| **`MenuItem`** | `menu_items` | `src/restaurants/schemas/menu-item.schema.ts` | `Restaurant` | **Core** |
| **`Review`** | `reviews` | `src/reviews/schemas/review.schema.ts` | `Restaurant`, `User` | **Core** |
| **`FavoriteCollection`** | `favoritecollections` | `src/favorites/schemas/favorite-collection.schema.ts` | `Restaurant`, `User` | **Core** |
| **`TasteDnaProfile`** | `taste_dna_profiles` | `src/taste-dna/schemas/taste-dna.schema.ts` | `User` | **Core** |
| **`Interaction`** | `user_interactions` | `src/interactions/schemas/interaction.schema.ts` | `User` | **Core** |
| **`UserInteraction`** *(Duplicate)* | `user_interactions` | `src/users/schemas/user-interaction.schema.ts` | `Restaurant`, `MenuItem`, `User` | **Core** *(To Merge)* |
| **`Contact`** | `contacts` | `src/contacts/schemas/contact.schema.ts` | None | **Core** |
| **`Notification`** | `notifications` | `src/users/schemas/notification.schema.ts` | `User`, `Itinerary` *(Cross-boundary foreign key!)* | **Core** |
| **`AuditLog`** | `auditlogs` | `src/users/schemas/audit-log.schema.ts` | `User` | **Core** |
| **`ChatSession`** | `chat_sessions` | `src/restaurants/schemas/chat-session.schema.ts` | `User` | **Core** |
| **`Itinerary`** | `itinerarys` | `src/itineraries/schemas/itinerary.schema.ts` | `Restaurant`, `User` *(Cross-boundary foreign key!)* | **Planning** |
| **`ItineraryStop`** | Embedded in `Itinerary` | `src/itineraries/schemas/itinerary.schema.ts` | `Restaurant`, `User` *(Cross-boundary foreign key!)* | **Planning** |

---

## 4. VERIFIED ARCHITECTURAL DEFECTS & TIGHT COUPLING EVIDENCE

### 4.1. Cross-Domain Coupling in `ItinerariesService` (Violation of Database per Service)
- **Source File:** `src/itineraries/itineraries.service.ts`
- **Lines:** 88–93
- **Verifiable Code:**
  ```typescript
  constructor(
    @InjectModel(Itinerary.name) private itineraryModel: Model<Itinerary>,
    @InjectModel(Restaurant.name) private restaurantModel: Model<Restaurant>,
    private readonly httpService: HttpService,
    private readonly tasteDnaService: TasteDnaService,
    private readonly interactionsService: InteractionsService,
  ) {}
  ```
- **Evidence of Coupling:**
  1. Direct database queries on `restaurants` collection: Lines 257, 268, 276 (`this.restaurantModel.find()`), line 555 (`this.restaurantModel.findById()`), line 841 (`this.restaurantModel.find({ _id: { $in: restaurantIds } })`).
  2. Direct service injection of `TasteDnaService`: Line 287 (`this.tasteDnaService.getProfile(userId)`), line 860 (`this.tasteDnaService.applyFeedbackEma(...)`).
  3. Direct service injection of `InteractionsService`: Line 832 (`this.interactionsService.recordEvent(...)`).
- **Architectural Impact:** Planning Service cannot be deployed with an isolated database (`gastro_planning`) until these 3 dependencies are replaced by internal REST contracts.

### 4.2. Schema Coupling in `Notification` & `ItineraryStop`
- `src/users/schemas/notification.schema.ts:16`: `@Prop({ type: Types.ObjectId, ref: 'Itinerary' }) itineraryId: Types.ObjectId;` -> If Itineraries move to Planning database, Mongoose `populate('itineraryId')` across databases will throw runtime errors.
- `src/itineraries/schemas/itinerary.schema.ts:11`: `@Prop({ type: Types.ObjectId, ref: 'Restaurant' }) restaurant_id: Restaurant | Types.ObjectId;` -> Violates data isolation. Must be converted to an immutable snapshot value object.

### 4.3. Schema Redundancy: Duplicate Schemas for `user_interactions`
- `src/users/schemas/user-interaction.schema.ts` and `src/interactions/schemas/interaction.schema.ts` both target `@Schema({ collection: 'user_interactions' })`.
- `UserInteraction` in `users/` has older fields (`actionType: string`), while `Interaction` in `interactions/` uses an enterprise enum (`InteractionEventType`, `TargetType`).
- **Resolution:** Deprecate `users/schemas/user-interaction.schema.ts` and consolidate exclusively on `interactions/schemas/interaction.schema.ts`.

### 4.4. Cross-Tier 404 Route Mismatch with AI Microservice [P0]
- `src/restaurants/restaurants.service.ts`:
  - Line 448 calls `${aiBaseUrl}/v1/recommendation/recommend/hybrid`
  - Line 547 calls `${aiBaseUrl}/v1/recommendation/cf/train`
  - Line 969 calls `${aiBaseUrl}/v1/copilot/message`
- In `KLTN-123-GastroWise-AI/main.py:32` & `app/api/v1/router.py:9-15`, FastAPI mounts routes without `/v1` (`/recommend/hybrid`, `/cf/train`, `/copilot/message`).
- **Impact:** 100% of hybrid recommendations and copilot queries return 404, silently dropping back to database sort and regex fallback.

### 4.5. Broken Object Level Authorization & Missing Guards [P0]
- `src/reviews/reviews.controller.ts`:
  - Line 19 (`POST /reviews`): Missing `JwtAuthGuard` (client can spoof `userId`).
  - Lines 48–55 (`DELETE /reviews/:id` & `PATCH /reviews/:id`): Zero guards, zero ownership check. Anyone can delete or mutate any user's review.
  - Line 58 (`POST /reviews/migrate-sentiment`): Unprotected bulk migration trigger.
- `src/interactions/interactions.controller.ts`:
  - Line 67 (`GET /interactions/matrix`): Publicly dumps 5,000 user interaction logs without authentication.

### 4.6. Mobile API Gateway Prefix Inconsistency [P1]
- `KLTN-123-GastroWise-Mobile/.env:6`: `EXPO_PUBLIC_API_URL=http://...:3001/api/v1`
- `src/main.ts`: No `app.setGlobalPrefix('api/v1')` configured.
- When mobile calls backend directly, all routes fail with 404.

---

## 5. AUDIT CONCLUSION & VERIFICATION EVIDENCE
The backend repository is functional as a Modular Monolith, but suffers from tight cross-domain coupling in `ItinerariesService` and critical authorization gaps. The proposed migration to **Core Service** (:3001) and **Planning Service** (:3003) mediated by an **Nginx API Gateway** (:8080) directly resolves these coupling and security defects.

