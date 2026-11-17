# IMPLEMENTATION PROMPT: P1-003 – ALIGN PREDICT-FOOD DEFAULT FALLBACK PORT

## 1. OBJECTIVE
Correct the default AI service fallback port from `8000` to `5000` in `KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts` to ensure image-based dish recognition resolves to the active FastAPI microservice.

## 2. PROBLEM DESCRIPTION
In `restaurants.service.ts:223`, the fallback URL is written as `const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';`. However, the GastroWise AI Microservice is standardized to execute on port `5000` across all other endpoints. When `AI_SERVICE_URL` is omitted, image search requests fail with `ECONNREFUSED`.

## 3. SOURCE FILES TO INSPECT
- `KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts`: Lines 220–240.

## 4. FILES ALLOWED TO MODIFY
- `KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts`: Line 223 only.

## 5. FILES THAT MUST NOT BE MODIFIED
- `KLTN-123-GastroWise-BE/src/restaurants/restaurants.controller.ts`
- `KLTN-123-GastroWise-AI/*`

## 6. EXPECTED BEHAVIOR
- If `process.env.AI_SERVICE_URL` is not defined, `restaurants.service.ts` defaults consistently to `'http://127.0.0.1:5000'`.

## 7. TECHNICAL CONSTRAINTS
- Minimal 1-line surgical change. Zero impact on business logic or image upload handling.

## 8. ACCEPTANCE CRITERIA
- Source line in `restaurants.service.ts:223` defaults to `'http://127.0.0.1:5000'`.
- Running `searchByImage` without environment override dispatches HTTP POST to `http://127.0.0.1:5000/predict-food`.

## 9. UNIT TESTS
- Verify service instance uses port 5000 as default when config is empty.

## 10. INTEGRATION TESTS
- Trigger `POST /restaurants/search-by-image` with sample food image; verify request hits AI service on port 5000.

## 11. REGRESSION TESTS
- `npm run test -- restaurants.service.spec.ts`

## 12. VERIFICATION COMMANDS
```bash
python -c "with open('KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts') as f: text = f.read(); assert 'http://127.0.0.1:8000' not in text"
```

## 13. ROLLBACK CONSIDERATIONS
Revert line 223 to previous string.

