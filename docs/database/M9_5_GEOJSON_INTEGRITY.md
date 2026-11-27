# M9.5 — GeoJSON & Geospatial Integrity Remediation (`BLK-04`)

**Milestone:** M9.5 (`P1.2` from [`M8_8_REMEDIATION_ROADMAP.md`](./M8_8_REMEDIATION_ROADMAP.md))  
**Blocker Addressed:** `BLK-04` (Invalid GeoJSON default `[106.7009, 10.7769]` & unsafe distance fallbacks)

---

## 1. Root Causes Confirmed

1. [`Restaurant`](../../apps/core-service/src/restaurants/schemas/restaurant.schema.ts) defaulted `location.coordinates` to `[106.7009, 10.7769]` (District 1, HCMC) and `type` to `'Point'` on every un-geocoded restaurant insert.
2. [`RestaurantsService`](../../apps/core-service/src/restaurants/restaurants.service.ts) executed `ensureGeoJsonLocations()` inside `onApplicationBootstrap()` on every boot and `create()` silently substituted `10.7769` / `106.7009` whenever coordinates were missing or `0`.
3. `RestaurantsController.findNearby()`, `InternalRestaurantsController`, and `ItinerariesService` fell back to `10.7769` / `106.7009` or `[0, 0]` (`calculateHaversineDistanceKm` returning `1.5`), polluting District 1 `$geoNear` results and distorting itinerary distances.
4. `ItinerariesService.recalculateTimetableAndMetrics()` declared `prevLng` as `const`, causing multi-stop leg calculations to reuse `startLng` across all stops instead of advancing longitude.

---

## 2. Implemented Changes

| Component | Remediation | Verification |
| :--- | :--- | :--- |
| [`libs/shared/src/utils/geo.utils.ts`](../../libs/shared/src/utils/geo.utils.ts) | Added `parseValidCoordinatePair()`, `toGeoJsonPoint()`, `extractValidGeoPoint()`, and `isValidGeoJsonPoint()` enforcing finite WGS84 bounds (`lat` in `[-90, 90]`, `lon` in `[-180, 180]`), comma-decimal parsing, `[lon, lat]` order, and rejection of `[0, 0]`. | [`geo.utils.spec.ts`](../../libs/shared/src/utils/geo.utils.spec.ts) |
| [`apps/core-service/src/restaurants/schemas/restaurant.schema.ts`](../../apps/core-service/src/restaurants/schemas/restaurant.schema.ts) | Replaced nested default sub-object with explicit Mongoose sub-schema (`_id: false`), `default: null`, `required: false`, and schema-level validator `isValidGeoJsonPoint`. Kept `{ location: '2dsphere' }` index. | [`restaurants.geo-integrity.spec.ts`](../../apps/core-service/src/restaurants/restaurants.geo-integrity.spec.ts) & [`data-integrity.spec.ts`](../../libs/shared/src/contracts/data-integrity.spec.ts) |
| [`apps/core-service/src/restaurants/restaurants.service.ts`](../../apps/core-service/src/restaurants/restaurants.service.ts) | Removed `OnApplicationBootstrap` and `ensureGeoJsonLocations()`. Updated `create()` & `update()` to store `location: null` when coordinates are omitted/cleared and throw `BadRequestException` on partial, out-of-range, or `[0, 0]` coordinates. Filtered un-geocoded and `[0, 0]` documents out of `$geoNear` and Haversine fallback in `findNearby()`; preserved `null` distance for un-geocoded entries in `findAll()`. | [`restaurants.geo-integrity.spec.ts`](../../apps/core-service/src/restaurants/restaurants.geo-integrity.spec.ts) |
| [`apps/core-service/src/restaurants/restaurants.controller.ts`](../../apps/core-service/src/restaurants/restaurants.controller.ts) | Required validated non-zero `(lat, lon/lng)` on `GET /restaurants/nearby` (throws `BadRequestException` instead of silently defaulting to District 1). | Compiled & typechecked |
| [`apps/core-service/src/internal/internal-restaurants.controller.ts`](../../apps/core-service/src/internal/internal-restaurants.controller.ts) | Replaced `|| 10.7769` / `|| 106.7009` DTO fallback with `extractValidGeoPoint()`, excluded `[0, 0]` from `$near` candidate filter, and validated spatial query parameters. | Compiled & typechecked |
| [`apps/planning-service/src/itineraries/itineraries.service.ts`](../../apps/planning-service/src/itineraries/itineraries.service.ts) | Rejected missing / `[0, 0]` start coordinates in `generateItinerary()`, `recalculateTimetableAndMetrics()`, `reorderStops()`, `addStop()`, `removeStop()`, and `recalculateItinerary()`. Filtered out un-geocoded candidates before scoring/routing. Rejected `addStop` on un-geocoded restaurants. Fixed `let prevLng = startPoint.lon` advancement across multi-stop recalculations. | [`itineraries.service.spec.ts`](../../apps/planning-service/src/itineraries/itineraries.service.spec.ts) |
| [`scripts/migrations/core/v003_geojson_cleanup.migration.ts`](../../scripts/migrations/core/v003_geojson_cleanup.migration.ts) | Versioned `V003` migration cleaning fabricated Q1 defaults on un-geocoded venues and backfilling valid `[lon, lat]` coordinates in batches of `500`, snapshotting prior state into `_migration_audit_v003`. | Executed live against ephemeral `mongo:7.0` DB |

---

## 3. Geospatial Index & Query Verification

- `RestaurantSchema.index({ location: '2dsphere' })` remains indexed and natively ignores `location: null` documents.
- `findNearby` adds `'location.type': 'Point'`, `'location.coordinates.0': { $type: 'number', $gte: -180, $lte: 180 }`, `'location.coordinates.1': { $type: 'number', $gte: -90, $lte: 90 }`, and `'location.coordinates': { $ne: [0, 0] }` to `$geoNear.query` so un-geocoded or corrupted Null Island records cannot enter nearby searches.
