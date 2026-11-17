# IMPLEMENTATION PROMPT: P0-004 – PROTECT INTERACTION MATRIX EXPORT ENDPOINT

## 1. OBJECTIVE
Remediate sensitive data exposure (OWASP API3) on `GET /interactions/matrix` in `KLTN-123-GastroWise-BE` by restricting access to Admin users and authorized internal microservices.

## 2. PROBLEM DESCRIPTION
`GET /interactions/matrix?limit=5000` is currently open to the public internet without authentication. Any caller can dump 5,000 raw user interaction logs, including user IDs, target IDs, dwell times, and behavioral event types.

## 3. SOURCE FILES TO INSPECT
- `KLTN-123-GastroWise-BE/src/interactions/interactions.controller.ts`: Lines 67–70.
- `KLTN-123-GastroWise-BE/src/auth/jwt-auth.guard.ts`
- `KLTN-123-GastroWise-BE/src/auth/roles.guard.ts`

## 4. FILES ALLOWED TO MODIFY
- `KLTN-123-GastroWise-BE/src/interactions/interactions.controller.ts`

## 5. FILES THAT MUST NOT BE MODIFIED
- `KLTN-123-GastroWise-BE/src/interactions/interactions.service.ts` (Keep business export logic intact)
- `KLTN-123-GastroWise-BE/src/interactions/schemas/*`

## 6. EXPECTED BEHAVIOR
- Anonymous request to `GET /interactions/matrix` receives `401 Unauthorized`.
- Non-admin authenticated user receives `403 Forbidden`.
- Admin user or internal service request receives matrix payload.

## 7. TECHNICAL CONSTRAINTS
- Do not disrupt legitimate background training synchronization initiated by Admin Web or Admin Cron.

## 8. ACCEPTANCE CRITERIA
- `curl -i http://localhost:3001/interactions/matrix` returns HTTP 401.
- `curl -i -H "Authorization: Bearer <user_token>" http://localhost:3001/interactions/matrix` returns HTTP 403.
- `curl -i -H "Authorization: Bearer <admin_token>" http://localhost:3001/interactions/matrix` returns HTTP 200 with interaction array.

## 9. UNIT TESTS
- `interactions.controller.spec.ts`: Test guard metadata on `getMatrixExport()`.

## 10. INTEGRATION TESTS
- Verify Admin Web sync button `/restaurants/recommender/sync-cf` continues functioning with admin JWT.

## 11. REGRESSION TESTS
- `npm run test -- interactions.controller.spec.ts`

## 12. VERIFICATION COMMANDS
```bash
npm run test -- interactions
```

## 13. ROLLBACK CONSIDERATIONS
Revert `@UseGuards` on `getMatrixExport` in `interactions.controller.ts`.

