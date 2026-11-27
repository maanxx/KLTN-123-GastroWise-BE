# M9.3 — DTO & MongoDB Schema Validation Alignment

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feature/m9-3-dto-schema-integrity`
- **Companion Docs:** [`M9_3_VALIDATION_TEST_REPORT.md`](./M9_3_VALIDATION_TEST_REPORT.md), [`M8_6_INTEGRITY_VALIDATION_MATRIX.md`](./M8_6_INTEGRITY_VALIDATION_MATRIX.md)

---

## 1. Complete DTO Inventory (M9.3.1)

| DTO | Endpoint(s) | Service / Model | Required Fields | Key Constraints & M9.3 Alignments |
|---|---|---|---|---|
| `LoginDto` | `POST /auth/login` | `AuthService` / `User` | `email`, `password` (`min 6`) | `@IsEmail`, `@IsString`, `@MinLength(6)` |
| `RegisterDto` | `POST /auth/register` | `AuthService` / `User` | `email`, `password`, `username` | Extends `LoginDto`; added typed auth action DTOs |
| `RefreshTokenDto`, `ForgotPasswordDto`, `ResetPasswordDto`, `Enable2FADto`, `ResetPassword2FADto` | `POST /auth/refresh`, `forgot-password`, `reset-password`, `2fa/*` | `AuthService` / `User` | Route-specific (`email`, `otp`, `userId`, `refreshToken`, `code`) | **M9.3 New:** Replaced inline `@Body() body: { ... }` so `whitelist: true` preserves auth payloads |
| `CreateUserDto` & `UpdateUserDto` | `POST /users`, `PATCH /users/:id`, `PATCH /auth/profile` | `UsersService` / `User` | `username`, `email`, `password` (create) | **M9.3 Fixed:** Moved `@IsUrl()` from `firstName` to `picture`; added `@IsIn` `role`/`status` for Admin while non-admin RBAC strips them |
| `CreateReviewDto` & `UpdateReviewDto` | `POST /reviews`, `PATCH /reviews/:id` | `ReviewsService` / `Review` | `diemReview`, `noiDung`, `restaurantId` (create) | **M9.3 Fixed (`BLK-03`):** Tightened `diemReview` `@Min(1) @Max(5)` (`ReviewSchema` matched), `@IsMongoId()` optional `userId`, `noiDung` max 2000; added `status`, `isFeatured`, nullable `pinnedAt` to `UpdateReviewDto`; typed `ReviewsController.update` |
| `CreateRestaurantDto` & `UpdateRestaurantDto` | `POST /restaurants`, `PATCH /restaurants/:id` | `RestaurantsService` / `Restaurant` | `tenQuan` (create) | **M9.3 Fixed (`BLK-05`):** Replaced empty `{}` class with full Admin-compatible DTO (`moTa` $\rightarrow$ `description`, geo bounds, `status` enum) |
| `CreateMenuItemDto` & `UpdateMenuItemDto` | `POST /restaurants/:id/menu`, `PATCH /restaurants/menu/:menuId` | `RestaurantsService` / `MenuItem` | `name`, `price` (create) | **M9.3 New:** Replaced `@Body() dto: any`; enforced `price >= 0`, `calories >= 0` in both DTO and `MenuItemSchema` |
| `ChatRestaurantDto` | `POST /restaurants/chat` | `RestaurantsService` | `message` | **M9.3 New:** Replaced inline `{ message, userLat, userLon }` |
| `CreateContactDto` & `UpdateContactStatusDto` | `POST /contacts`, `PATCH /contacts/:id` | `ContactsService` / `Contact` | `name`, `phone`, `email`, `topic`, `message`; `status` | **M9.3 Fixed:** Added `ContactSchema.status` enum & `UpdateContactStatusDto` (`CHỜ XỬ LÝ`, `ĐANG XỬ LÝ`, `ĐÃ GIẢI QUYẾT`) |
| `UpdateTasteDnaDto` & `TasteQuizDto` | `PATCH /taste-dna/me`, `POST /taste-dna/quiz` | `TasteDnaService` / `TasteDnaProfile` | 6 flavor dims optional (`[0,1]`); quiz fields | **M9.3 Fixed:** Added `@IsIn(['budget', 'medium', 'fine_dining'])` to `budgetPreference` |
| `CreateInteractionDto` & `BatchInteractionDto` | `POST /interactions/event`, `/batch` | `InteractionsService` / `Interaction` | `eventType`, `targetType`, `targetId` | Existing nested `@ValidateNested({ each: true })` + `@Type(() => CreateInteractionDto)` verified |
| `GenerateItineraryDto`, `AddStopDto`, `ReorderStopsDto`, `RecalculateItineraryDto`, `UpdateItineraryStatusDto` | `POST /itineraries/*`, `PATCH /itineraries/:id*` | `ItinerariesService` / `Itinerary` | `prompt`, `start_time`, `end_time` (generate); `status` (patch) | **M9.3 Fixed:** `@IsIn(['motorbike','car','walking'])`, coordinate/budget/stop bounds, `ItinerarySchema.status` enum + typed `UpdateItineraryStatusDto` |

---

## 2. Global ValidationPipe & Service Update Alignment (M9.3.5)

- Enabled `new ValidationPipe({ whitelist: true, transform: true })` in both [`apps/core-service/src/main.ts`](../../apps/core-service/src/main.ts#L20) and [`apps/planning-service/src/main.ts`](../../apps/planning-service/src/main.ts#L29).
- Enabled Mongoose `{ runValidators: true }` on `findByIdAndUpdate` in `RestaurantsService` (`update`, `updateMenuItem`), `ReviewsService.updateReview`, `UsersService` (`update`, `updateProfile`), and `ContactsService.updateStatus`.
- Updated `ReviewsService.create` to throw `BadRequestException` when `restaurantId` is neither a valid 24-hex `ObjectId` nor matched by restaurant `slug` / `urlGoc`, preventing raw BSON `500` errors.

---

## 3. Proposed MongoDB `$jsonSchema` Validator Migrations (M9.3.4)

Per M9.3 safety rules, `$jsonSchema` collection validators are **NOT** applied automatically to live collections before staging anomaly remediation (M9.4 GeoJSON / V004-V005 cleanup), preventing rejection of legacy historical docs. Below is the proposed M9.1-compatible `collMod` specification (`validationLevel: 'moderate'`, starting with `validationAction: 'warn'` in staging before switching to `'error'`):

```javascript
// Proposed V007_collection_json_schemas (Execute ONLY after V003/V004/V005 cleanup)
db.runCommand({
  collMod: 'reviews',
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['restaurantId'],
      properties: {
        diemReview: { bsonType: ['int', 'double'], minimum: 1, maximum: 5 },
        status: { enum: ['active', 'hidden', 'pending'] },
        restaurantId: { bsonType: 'objectId' },
      },
    },
  },
  validationLevel: 'moderate',
  validationAction: 'error',
});

db.runCommand({
  collMod: 'restaurants',
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['status'],
      properties: {
        status: { enum: ['open', 'closed', 'pending'] },
        tags: { bsonType: ['string', 'null'] }, // Prevents Array-vs-String crash in findNearby
      },
    },
  },
  validationLevel: 'moderate',
  validationAction: 'error',
});
```
