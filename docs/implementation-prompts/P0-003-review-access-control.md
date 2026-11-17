# IMPLEMENTATION PROMPT: P0-003 – REVIEW ACCESS CONTROL & AUTHORIZATION ENFORCEMENT

## 1. OBJECTIVE
Remediate critical Broken Object Level Authorization (BOLA) and missing authentication guards on the Reviews endpoints in `KLTN-123-GastroWise-BE`.

## 2. PROBLEM DESCRIPTION
`POST /reviews` does not enforce `JwtAuthGuard`, allowing arbitrary `userId` submission. `DELETE /reviews/:id` and `PATCH /reviews/:id` have zero authentication and zero ownership checks, allowing any anonymous client to delete or tamper with any review in MongoDB. `POST /reviews/migrate-sentiment` has no admin protection.

## 3. SOURCE FILES TO INSPECT
- `KLTN-123-GastroWise-BE/src/reviews/reviews.controller.ts`: Lines 19–61.
- `KLTN-123-GastroWise-BE/src/reviews/reviews.service.ts`: Deletion and update methods.
- `KLTN-123-GastroWise-BE/src/auth/jwt-auth.guard.ts`: JWT guard.

## 4. FILES ALLOWED TO MODIFY
- `KLTN-123-GastroWise-BE/src/reviews/reviews.controller.ts`
- `KLTN-123-GastroWise-BE/src/reviews/reviews.service.ts`
- `KLTN-123-GastroWise-BE/src/reviews/dto/update-review.dto.ts` (Create if needed)

## 5. FILES THAT MUST NOT BE MODIFIED
- `KLTN-123-GastroWise-BE/src/restaurants/*`
- `KLTN-123-GastroWise-BE/src/users/*`

## 6. EXPECTED BEHAVIOR
- `POST /reviews`: Requires valid Bearer JWT. `userId` is extracted from `req.user.sub` or `req.user.id`.
- `DELETE /reviews/:id`: Requires valid Bearer JWT. Throws `ForbiddenException` (403) if caller is neither review author nor admin.
- `PATCH /reviews/:id`: Requires valid Bearer JWT. Validates update payload and verifies author/admin ownership.
- `POST /reviews/migrate-sentiment`: Requires Admin role (`@Roles(Role.Admin)`).

## 7. TECHNICAL CONSTRAINTS
- Preserve public read access on `GET /reviews`, `GET /reviews/stats`, and `GET /reviews/restaurant/:id`.
- Do not break existing mobile or web customer review display.

## 8. ACCEPTANCE CRITERIA
- Unauthenticated `DELETE /reviews/:id` returns 401 Unauthorized.
- User A attempting to delete User B's review returns 403 Forbidden.
- User A deleting their own review succeeds with 200 OK.
- Admin deleting any review succeeds with 200 OK.

## 9. UNIT TESTS
- `reviews.controller.spec.ts`: Test missing auth returns 401; non-owner delete returns 403.
- `reviews.service.spec.ts`: Test delete logic verifies ownership against user ID.

## 10. INTEGRATION TESTS
- E2E API test: Login as User 1 $\rightarrow$ Post review $\rightarrow$ Login as User 2 $\rightarrow$ Attempt delete (expect 403) $\rightarrow$ Login as User 1 $\rightarrow$ Delete (expect 200).

## 11. REGRESSION TESTS
- `npm run test` on `reviews` module passes cleanly.

## 12. VERIFICATION COMMANDS
```bash
npm run test -- reviews.controller.spec.ts
```

## 13. ROLLBACK CONSIDERATIONS
Revert guard annotations in `reviews.controller.ts`.

