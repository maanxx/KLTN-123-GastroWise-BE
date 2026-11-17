# IMPLEMENTATION PROMPT: P0-001 – INTERNAL AI SERVICE MUTUAL AUTHENTICATION

## 1. OBJECTIVE
Implement mutual inter-service authentication between NestJS Backend (and Planning Service) and FastAPI AI Service using a pre-shared secret key passed in header `X-Internal-AI-Key`.

## 2. PROBLEM DESCRIPTION
Currently, FastAPI AI Service has `CORSMiddleware` with `allow_origins=["*"]` and checks zero authentication headers. Any party on the local network or internet that can reach port 5000 can invoke heavy AI inference endpoints (`/recommend/hybrid`, `/routes/optimize`, `/cf/train`).

## 3. SOURCE FILES TO INSPECT
- `KLTN-123-GastroWise-AI/main.py`: CORS and router inclusion.
- `KLTN-123-GastroWise-AI/app/config.py`: Environment variable loading.
- `KLTN-123-GastroWise-AI/app/api/v1/router.py`: Router definitions.
- `KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts`: HTTP service calls.
- `KLTN-123-GastroWise-BE/src/itineraries/itineraries.service.ts`: HTTP service calls.

## 4. FILES ALLOWED TO MODIFY
- `KLTN-123-GastroWise-AI/app/core/security.py` (Create)
- `KLTN-123-GastroWise-AI/app/config.py` (Add `AI_INTERNAL_KEY`)
- `KLTN-123-GastroWise-AI/main.py` (Mount security dependency)
- `KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts` (Inject header in calls)
- `KLTN-123-GastroWise-BE/src/itineraries/itineraries.service.ts` (Inject header in calls)

## 5. FILES THAT MUST NOT BE MODIFIED
- `KLTN-123-GastroWise-AI/app/core/route_optimizer.py`
- `KLTN-123-GastroWise-AI/app/core/recommender.py`
- Client web / mobile code.

## 6. EXPECTED BEHAVIOR
- Incoming requests to FastAPI endpoints without `X-Internal-AI-Key` or with invalid key receive `401 Unauthorized`.
- Incoming requests with valid `X-Internal-AI-Key` are processed normally.
- NestJS Backend automatically includes the secret in all outgoing HTTP requests to AI Service.

## 7. TECHNICAL CONSTRAINTS
- Use constant-time comparison (`secrets.compare_digest`) in Python to prevent timing attacks.
- Do not hardcode secret in code; read from `AI_INTERNAL_KEY` environment variable.
- Preserve backward-compatibility for `/` root health probe (allow unauthenticated).

## 8. ACCEPTANCE CRITERIA
- `curl -X POST http://127.0.0.1:5000/routes/optimize` returns `401 Unauthorized`.
- `curl -X POST http://127.0.0.1:5000/routes/optimize -H "X-Internal-AI-Key: <valid_key>"` returns `200 OK` or `422 Unprocessable` (schema error, not auth error).
- Backend NestJS calling AI endpoints succeeds with 200 OK.

## 9. UNIT TESTS
- `test_internal_auth_valid_key()`: Verifies HTTP 200 with valid key.
- `test_internal_auth_missing_key()`: Verifies HTTP 401 when header missing.
- `test_internal_auth_invalid_key()`: Verifies HTTP 401 when key incorrect.

## 10. INTEGRATION TESTS
- Trigger backend recommendation flow; verify Backend successfully passes key and receives AI response.

## 11. REGRESSION TESTS
- Verify existing tests in `KLTN-123-GastroWise-AI` pass.

## 12. VERIFICATION COMMANDS
```bash
pytest test_hybrid_recommendation.py
curl -i -X POST http://127.0.0.1:5000/recommend/hybrid -H "Content-Type: application/json" -d "{}"
```

## 13. ROLLBACK CONSIDERATIONS
If service communication fails, remove `dependencies=[Depends(verify_internal_key)]` in `main.py`.

