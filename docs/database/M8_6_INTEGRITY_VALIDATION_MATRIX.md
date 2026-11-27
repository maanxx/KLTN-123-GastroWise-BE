# M8.6 — Data Integrity Validation Matrix

Cross-layer matrix contrasting **API DTO Validation**, **Mongoose Schema Validation**, **MongoDB Collection Constraints**, and **Required Integrity Checks** across all active GastroWise collections.

| Collection | Field / Reference | API DTO Check (`class-validator`) | Mongoose Schema Check | MongoDB Server Check | Gap / Required Action (Future M8.7+) |
|---|---|---|---|---|---|
| `users` | `email` | `@IsEmail` (`CreateUserDto`, `RegisterDto`, `LoginDto`) | `required: true, unique: true` | Unique index `email_1` | Normalize `lowercase: true, trim: true`; handle case-insensitive collision |
| `users` | `hashedRefreshToken` | Internal-only | **MISSING `@Prop()`** | None | **P0:** Add `@Prop({ required: false })` + bcrypt hash before save |
| `users` | `resetOtp` | Internal-only | `required: false` | None | **P0:** Add `resetOtpExpiresAt: Date` + server expiry check |
| `users` | `firstName` / `picture` | **`@IsUrl()` on `firstName`!** | Both `string`, optional | None | **P1:** Move `@IsUrl()` to `picture`, keep `@IsString()` on `firstName` |
| `users` | `savedRestaurants[]` | Direct param `:restaurantId` (`ObjectId.isValid`) | `[ObjectId]` ref `'Restaurant'` | None | Add atomic `$addToSet`/`$pull`; prune on restaurant delete |
| `restaurants` | `tenQuan`, `diaChi`, `status` | **`CreateRestaurantDto` EMPTY** | `status` (`req`, enum) only | None | Define validated `CreateRestaurantDto` & `UpdateRestaurantDto`; require `tenQuan` |
| `restaurants` | `diemTrungBinh`, `reviewsCount` | Unvalidated (`empty DTO`) | Unbounded `number` (`reviewsCount` def `0`) | None | Add `ratingScale` + `rawRating` + `[0, 10]`/`[0, 5]` bounds |
| `restaurants` | `location.coordinates` | Unvalidated | `[Number]` def `[106.7009, 10.7769]` | `location_2dsphere` | Remove misleading Q1 default; validate `lon` `[-180,180]`, `lat` `[-90,90]` |
| `menu_items` | `restaurantId`, `price`, `calories` | Unvalidated (`dto: any`) | `restaurantId` `req`, `price` `req` (no `min`) | None | Create `MenuItemDto`, validate parent `restaurantId` exists, enforce `min: 0` |
| `reviews` | `diemReview` | `@Min(1) @Max(10)` (**bug**) | Unbounded `number` | None | Restrict DTO & Schema to `@Min(1) @Max(5)` (`5_point` review scale) |
| `reviews` | `restaurantId`, `userId` | `restaurantId` `@IsString` (not `@IsMongoId`) | `restaurantId` `req` `ObjectId` | None | Verify target restaurant exists cleanly; enforce partial unique `{userId, restaurantId}` |
| `contacts` | `phone`, `email`, `topic`, `status` | Regex phone, `@IsEmail`, `@IsEnum`, `@MinLength(10)` | `topic` enum; `status` unvalidated `string` | None | Add `enum: ['CHỜ XỬ LÝ', 'ĐANG XỬ LÝ', 'ĐÃ GIẢI QUYẾT']` on `Contact.status` |
| `user_interactions` | `eventType`, `targetType`, `targetId` | `@IsEnum` on both enums; `@IsString` `targetId` | Both enums `req`; `targetId` `req` | None | Remove colliding `users/schemas/user-interaction.schema.ts`; align event keys with AI CF |
| `taste_dna_profiles` | `spicy..bitter`, `budgetPreference` | `0.0–1.0` bounds; `budgetPreference` `@IsString` | `[0.0, 1.0]` bounds; `budgetPreference` enum | Unique `userId_1` | Add `@IsEnum` on `UpdateTasteDnaDto.budgetPreference`; atomic upsert |
| `itineraries` | `user_id`, `stops[].restaurant_id`, `routing_mode` | `routing_mode` `@IsString` (no `@IsIn`), `budget`/`lat`/`lng` unbounded | `user_id` `req`, `restaurant_id` `req`, `routing_mode` enum, `meal_type` enum | None | Validate geo/budget bounds in `GenerateItineraryDto`; add `status` enum |
