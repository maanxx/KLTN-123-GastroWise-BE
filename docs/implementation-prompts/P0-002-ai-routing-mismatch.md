# IMPLEMENTATION PROMPT: P0-002 – RESOLVE AI ROUTE PREFIX MISMATCH (404 FALLBACK)

## 1. OBJECTIVE
Resolve the 404 URL routing mismatch between NestJS Backend HTTP calls and FastAPI router paths, enabling actual AI inference for recommendations, collaborative filtering, and copilot dialogue.

## 2. PROBLEM DESCRIPTION
NestJS hardcodes calls to `${aiBaseUrl}/v1/recommendation/recommend/hybrid`, `${aiBaseUrl}/v1/recommendation/cf/train`, and `${aiBaseUrl}/v1/copilot/message`. FastAPI mounts routers without `/v1` or `/recommendation` prefix. Every request triggers HTTP 404, silently activating fallback logic in NestJS.

## 3. SOURCE FILES TO INSPECT
- `KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts`: Lines 448, 547, 969.
- `KLTN-123-GastroWise-AI/app/api/v1/router.py`: Lines 9–15.
- `KLTN-123-GastroWise-AI/main.py`: Line 32.

## 4. FILES ALLOWED TO MODIFY
- `KLTN-123-GastroWise-AI/app/api/v1/router.py` (Add `/v1` prefix or aliases)
- `KLTN-123-GastroWise-AI/main.py` (Include router with dual compatibility)
- `KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts` (Align paths)

## 5. FILES THAT MUST NOT BE MODIFIED
- `KLTN-123-GastroWise-AI/app/core/recommender.py`
- `KLTN-123-GastroWise-AI/app/core/nlu_service.py`

## 6. EXPECTED BEHAVIOR
- Both `/v1/recommendation/recommend/hybrid` and `/recommend/hybrid` route to `recommend_hybrid()`.
- Both `/v1/recommendation/cf/train` and `/cf/train` route to `train_cf()`.
- Both `/v1/copilot/message` and `/copilot/message` route to `copilot_chat()`.
- Backend HTTP calls receive HTTP 200 responses from AI.

## 7. TECHNICAL CONSTRAINTS
- Zero breaking changes for existing test scripts (`test_hybrid_recommendation.py`).
- Maintain enterprise RESTful `/v1` naming convention.

## 8. ACCEPTANCE CRITERIA
- `curl -X POST http://127.0.0.1:5000/v1/recommendation/recommend/hybrid` returns HTTP 200 (not 404).
- `curl -X POST http://127.0.0.1:5000/v1/copilot/message` returns HTTP 200 (not 404).
- NestJS logs show successful AI response without triggering fallback.

## 9. UNIT TESTS
- Test router mounting in FastAPI asserting both `/v1/...` and base routes respond.

## 10. INTEGRATION TESTS
- Invoke `getHybridRecommendations()` from NestJS; verify AI payload is received and parsed.

## 11. REGRESSION TESTS
- Run `test_hybrid_recommendation.py` to ensure local tests pass.

## 12. VERIFICATION COMMANDS
```bash
python -c "from app.api.v1.router import api_v1_router; print([r.path for r in api_v1_router.routes])"
```

## 13. ROLLBACK CONSIDERATIONS
Revert router prefix changes in `app/api/v1/router.py`.

