# M9.5 — Isolated Staging Data-Profile Audit Procedure (`BLK-11`)

**Milestone:** M9.5 (`P1.2` from [`M8_8_REMEDIATION_ROADMAP.md`](./M8_8_REMEDIATION_ROADMAP.md))  
**Blocker Tracked:** `BLK-11` — Real Staging-Clone Data Profile & `explain("executionStats")` Audit

> [!IMPORTANT]
> **Status of `BLK-11`: UNRESOLVED (Authorized Staging Clone Required)**  
> Per M9.5 safety constraints, zero connections were made to MongoDB Atlas, zero real user records were inspected, and zero migrations were executed against Atlas. Code fixes (`BLK-04`, `BLK-07`) have been validated only against unit tests and ephemeral synthetic local fixtures. Complete this read-only audit once an explicitly isolated staging clone of production Atlas data is provisioned and authorized.

---

## 1. Snapshot Isolation & Database Mapping

1. **Snapshot Source:** Restore an isolated MongoDB Atlas backup/snapshot (`M10+` PITR or `mongodump --archive --gzip`) into a separate non-production staging cluster or isolated Docker staging instance (`NEVER` run against live production Atlas).
2. **Database Split Mapping:**
   - Source legacy monolith DB `gastrowise` (or split DBs) $\rightarrow$ `gastro_core_staging` (`restaurants`, `menu_items`, `reviews`, `users`, `contacts`, `user_interactions`, `taste_dna_profiles`, `favorite_collections`, `chat_sessions`, `notifications`, `audit_logs`)
   - Source itineraries $\rightarrow$ `gastro_planning_staging` (`itineraries`)
3. **Expected Collection Inventory Check:**
   ```javascript
   db.getSiblingDB('gastro_core_staging').getCollectionNames().forEach(c =>
     print(c, db.getSiblingDB('gastro_core_staging').getCollection(c).countDocuments({}))
   );
   db.getSiblingDB('gastro_planning_staging').getCollectionNames().forEach(c =>
     print(c, db.getSiblingDB('gastro_planning_staging').getCollection(c).countDocuments({}))
   );
   ```

---

## 2. Read-Only Pre-Migration Anomaly Queries

Execute the following strictly read-only queries against `gastro_core_staging` and record every count before running `npm run migrate:up -- --scope=core --dry-run`:

### 2.1 Case-Variant & Unnormalized Email Analysis (`users`)
```javascript
// 1. Detect case/whitespace collisions BEFORE lowercasing (must equal 0 groups before V004 applies)
db.users.aggregate([
  { $project: { email: 1, normalized: { $toLower: { $trim: { input: "$email" } } } } },
  { $group: { _id: "$normalized", count: { $sum: 1 }, emails: { $push: "$email" }, ids: { $push: "$_id" } } },
  { $match: { count: { $gt: 1 } } }
]);

// 2. Count mixed-case or untrimmed emails
db.users.countDocuments({ $expr: { $ne: ["$email", { $toLower: { $trim: { input: "$email" } } }] } });
```

### 2.2 Duplicate Review Analysis (`reviews`)
```javascript
db.reviews.aggregate([
  { $match: { userId: { $type: "objectId" } } },
  { $group: { _id: { userId: "$userId", restaurantId: "$restaurantId" }, count: { $sum: 1 }, ids: { $push: "$_id" } } },
  { $match: { count: { $gt: 1 } } }
]);
```

### 2.3 Orphan Reference Analysis (`menu_items`, `reviews`, `users.savedRestaurants`)
```javascript
// Orphan menu_items
db.menu_items.aggregate([
  { $lookup: { from: "restaurants", localField: "restaurantId", foreignField: "_id", as: "r" } },
  { $match: { "r.0": { $exists: false } } },
  { $count: "orphanMenuItems" }
]);

// Orphan reviews pointing to missing restaurants
db.reviews.aggregate([
  { $lookup: { from: "restaurants", localField: "restaurantId", foreignField: "_id", as: "r" } },
  { $match: { "r.0": { $exists: false } } },
  { $count: "orphanReviews" }
]);

// Users holding non-existent savedRestaurants ObjectIds
db.users.aggregate([
  { $match: { "savedRestaurants.0": { $exists: true } } },
  { $unwind: "$savedRestaurants" },
  { $lookup: { from: "restaurants", localField: "savedRestaurants", foreignField: "_id", as: "r" } },
  { $match: { "r.0": { $exists: false } } },
  { $count: "danglingSavedRestaurantRefs" }
]);
```

### 2.4 Invalid GeoJSON & District 1 Default Detection (`restaurants`)
```javascript
// 1. Detect fabricated District 1 [106.7009, 10.7769] defaults lacking real lat/lon
db.restaurants.countDocuments({
  "location.coordinates": [106.7009, 10.7769],
  $or: [{ lat: { $exists: false } }, { lat: null }, { lat: 0 }, { lon: { $exists: false } }, { lon: null }, { lon: 0 }]
});

// 2. Detect [0,0], out-of-range, or malformed GeoJSON points
db.restaurants.countDocuments({
  location: { $ne: null },
  $or: [
    { "location.coordinates": [0, 0] },
    { "location.coordinates.0": { $lt: -180 } },
    { "location.coordinates.0": { $gt: 180 } },
    { "location.coordinates.1": { $lt: -90 } },
    { "location.coordinates.1": { $gt: 90 } }
  ]
});
```

---

## 3. Index Inventory & Query Plan Verification (`explain("executionStats")`)

1. Collect index manifests across every staging collection (`collection.getIndexes()`).
2. Verify hot query paths achieve `IXSCAN` / `GEO_NEAR_2DSPHERE` with zero full `COLLSCAN` regressions:
   - `restaurants` nearby `$geoNear` (`location_2dsphere`)
   - `restaurants` status/rating listing (`status_1_diemTrungBinh_-1`)
   - `users` lowercase exact login lookup (`email_1`)
   - `reviews` listing (`restaurantId_1_status_1_createdAt_-1`) and uniqueness (`uniq_user_restaurant_review`)
   - `itineraries` user listing (`user_id_1_createdAt_-1`)
3. Record results in [`M8_3_STAGING_READINESS_CHECKLIST.md`](./M8_3_STAGING_READINESS_CHECKLIST.md) and close `BLK-11` only after staging-clone metrics and `V002`–`V004` dry-run outputs are signed off.
