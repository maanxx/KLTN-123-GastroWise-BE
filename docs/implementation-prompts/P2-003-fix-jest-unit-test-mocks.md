# IMPLEMENTATION PROMPT: P2-003 – PROVIDE MOCK DEPENDENCIES IN JEST UNIT TEST SUITES

## 1. OBJECTIVE
Resolve missing dependency injection mocks in 4 failing NestJS Jest unit test suites (`restaurants.controller.spec.ts`, `restaurants.service.spec.ts`, `reviews.controller.spec.ts`, `reviews.service.spec.ts`) in `KLTN-123-GastroWise-BE` so that all 14 test suites pass cleanly.

## 2. PROBLEM DESCRIPTION
Running `npm test` results in 4 failed suites because the test module setups (`TestingModule`) lack mock providers for services injected during Phase 2 development (e.g. `HttpService`, `TasteDnaService`, `InteractionsService`, `ConfigService`).

## 3. SOURCE FILES TO INSPECT
- `KLTN-123-GastroWise-BE/src/restaurants/restaurants.controller.spec.ts`
- `KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.spec.ts`
- `KLTN-123-GastroWise-BE/src/reviews/reviews.controller.spec.ts`
- `KLTN-123-GastroWise-BE/src/reviews/reviews.service.spec.ts`

## 4. FILES ALLOWED TO MODIFY
- The 4 `.spec.ts` files listed above.

## 5. FILES THAT MUST NOT BE MODIFIED
- `src/**/*.service.ts`
- `src/**/*.controller.ts`

## 6. EXPECTED BEHAVIOR
- Test modules define mock providers (`useValue: { ... }`) for all injected services.
- Tests execute isolated in-memory assertions without making real network or database calls.

## 7. TECHNICAL CONSTRAINTS
- Zero changes to actual production code.
- Mocks must return realistic fixture data matching DTO contracts.

## 8. ACCEPTANCE CRITERIA
- `npm test` executes with `14/14 Suites Passed`.
- Zero failures, zero uncaught exceptions in Jest runner.

## 9. UNIT TESTS
- All controller and service methods have basic unit coverage.

## 10. INTEGRATION TESTS
- Not applicable.

## 11. REGRESSION TESTS
- `npm test` passes completely.

## 12. VERIFICATION COMMANDS
```bash
npm test
```

## 13. ROLLBACK CONSIDERATIONS
Revert modifications in the 4 spec files.

