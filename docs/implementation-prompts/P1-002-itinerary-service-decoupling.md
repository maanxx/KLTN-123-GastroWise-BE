# IMPLEMENTATION PROMPT: P1-002 – DECOUPLE ITINERARY SERVICE & EXTRACT PLANNING DOMAIN

## 1. OBJECTIVE
Decouple `ItinerariesService` from direct monolithic schema and service injection (`RestaurantModel`, `TasteDnaService`, `InteractionsService`) and extract it into an autonomous `apps/planning-service` with an Anti-Corruption Layer (ACL).

## 2. PROBLEM DESCRIPTION
`ItinerariesService` ([itineraries.service.ts:88-93](file:///D:/GastroWise/KLTN-123-GastroWise-BE/src/itineraries/itineraries.service.ts#L88-L93)) violates microservices bounded contexts by directly querying the monolithic restaurant collection. This prevents separate database deployment (`gastro_planning`) and couples tour planning tightly to catalog schema modifications.

## 3. SOURCE FILES TO INSPECT
- `KLTN-123-GastroWise-BE/src/itineraries/itineraries.service.ts`
- `KLTN-123-GastroWise-BE/src/itineraries/itineraries.module.ts`
- `KLTN-123-GastroWise-BE/src/itineraries/schemas/itinerary.schema.ts`

## 4. FILES ALLOWED TO MODIFY
- `KLTN-123-GastroWise-BE/apps/planning-service/*` (Create in Milestone 3)
- `KLTN-123-GastroWise-BE/libs/shared/src/contracts/planning.contract.ts`
- `KLTN-123-GastroWise-BE/src/itineraries/itineraries.service.ts` (Prepare ACL interface)

## 5. FILES THAT MUST NOT BE MODIFIED
- `KLTN-123-GastroWise-BE/src/restaurants/schemas/restaurant.schema.ts`
- `KLTN-123-GastroWise-BE/src/taste-dna/schemas/taste-dna.schema.ts`

## 6. EXPECTED BEHAVIOR
- Planning Service queries restaurant candidates exclusively via `CoreApiClient` calling `GET /internal/restaurants/candidates`.
- Itinerary stops persist immutable snapshots (`restaurant_name`, `restaurant_lat`, `restaurant_lng`, `estimated_cost`) using `ItineraryStopSnapshot`.
- Zero Mongoose `populate('restaurant_id')` calls.

## 7. TECHNICAL CONSTRAINTS
- Strict adherence to Clean Architecture layers (Domain, Application, Infrastructure, Presentation).
- Zero shared database models.

## 8. ACCEPTANCE CRITERIA
- `apps/planning-service` builds independently via `nest build planning-service`.
- Planning Service starts on port 3003 and generates itineraries by calling mocked Core REST candidate endpoint.
- Existing itinerary data in MongoDB remains fully readable and backwards-compatible.

## 9. UNIT TESTS
- Test `CoreApiClient` ACL adapter translating external DTO to internal `RestaurantCandidate` domain entity.

## 10. INTEGRATION TESTS
- E2E Itinerary Generation Flow with Core Service and AI Service running.

## 11. REGRESSION TESTS
- Verify stop reordering (`reorderStops`) and remaining budget recalculation.

## 12. VERIFICATION COMMANDS
```bash
npm run test -- itineraries.service.spec.ts
```

## 13. ROLLBACK CONSIDERATIONS
Keep legacy `src/itineraries/` functional until Planning Service passes all integration benchmarks.

