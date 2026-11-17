# IMPLEMENTATION PROMPT: P1-005 – MOBILE APP API PREFIX & GATEWAY ALIGNMENT

## 1. OBJECTIVE
Align API URL prefix expectations between `KLTN-123-GastroWise-Mobile` (`/api/v1`) and the backend services via API Gateway routing configuration in Milestone 6.

## 2. PROBLEM DESCRIPTION
Mobile App `.env` defines `EXPO_PUBLIC_API_URL=http://...:3001/api/v1`, but NestJS monolith listens at root `/` with no global prefix. Direct calls from mobile devices without an intermediate API Gateway result in 404 Not Found.

## 3. SOURCE FILES TO INSPECT
- `KLTN-123-GastroWise-Mobile/.env`
- `KLTN-123-GastroWise-Mobile/src/constants/index.ts`
- `KLTN-123-GastroWise-BE/src/main.ts`

## 4. FILES ALLOWED TO MODIFY
- `KLTN-123-GastroWise-BE/nginx/nginx.conf` (Create Gateway proxy rules)
- `KLTN-123-GastroWise-Mobile/.env`

## 5. FILES THAT MUST NOT BE MODIFIED
- Mobile App screen UI and business hooks.

## 6. EXPECTED BEHAVIOR
- API Gateway listens on port 80/8080 and proxies `/api/v1/itineraries/*` to Planning Service and `/api/v1/*` to Core Service.
- Mobile client communicates with Gateway without prefix mismatch.

## 7. TECHNICAL CONSTRAINTS
- Support local testing on mobile physical devices via Wi-Fi IP and emulators.

## 8. ACCEPTANCE CRITERIA
- Mobile client successfully logs in and fetches restaurant list through `/api/v1/*`.

## 9. UNIT TESTS
- Test Gateway configuration syntax (`nginx -t`).

## 10. INTEGRATION TESTS
- Mobile app login flow verified against Gateway.

## 11. REGRESSION TESTS
- Web and Admin clients continue to resolve APIs without breakage.

## 12. VERIFICATION COMMANDS
```bash
curl -i http://localhost:8080/api/v1/restaurants/nearby?lat=10.7769&lon=106.7009
```

## 13. ROLLBACK CONSIDERATIONS
Revert mobile `EXPO_PUBLIC_API_URL` to point directly to backend port without prefix if Gateway is temporarily offline.

