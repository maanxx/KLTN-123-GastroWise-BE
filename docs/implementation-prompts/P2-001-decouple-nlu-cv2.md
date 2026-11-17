# IMPLEMENTATION PROMPT: P2-001 – DECOUPLE OPENCV DEPENDENCY FROM NLU SERVICE TEST

## 1. OBJECTIVE
Decouple the nutritional database from `vision_service.py` into a lightweight, standalone `app/core/nutrition_data.py` module, allowing `test_nlu_copilot.py` to run independently without requiring `opencv-python` (`cv2`).

## 2. PROBLEM DESCRIPTION
`app/core/nlu_service.py:3` imports `VIETNAMESE_FOOD_NUTRITION` from `app.core.vision_service`. However, `vision_service.py:2` unconditionally imports `cv2`. Environments or containers running NLP dialogue tasks crash with `ModuleNotFoundError: No module named 'cv2'` when importing `nlu_service`.

## 3. SOURCE FILES TO INSPECT
- `KLTN-123-GastroWise-AI/app/core/nlu_service.py`: Line 3.
- `KLTN-123-GastroWise-AI/app/core/vision_service.py`: Lines 1–40 (Where `VIETNAMESE_FOOD_NUTRITION` is defined).
- `KLTN-123-GastroWise-AI/test_nlu_copilot.py`

## 4. FILES ALLOWED TO MODIFY
- `KLTN-123-GastroWise-AI/app/core/nutrition_data.py` (Create)
- `KLTN-123-GastroWise-AI/app/core/vision_service.py` (Re-export or import from `nutrition_data.py`)
- `KLTN-123-GastroWise-AI/app/core/nlu_service.py` (Import from `nutrition_data.py`)

## 5. FILES THAT MUST NOT BE MODIFIED
- `KLTN-123-GastroWise-AI/app/core/route_optimizer.py`
- `KLTN-123-GastroWise-AI/app/core/recommender.py`

## 6. EXPECTED BEHAVIOR
- `VIETNAMESE_FOOD_NUTRITION` dictionary lives in `app/core/nutrition_data.py`.
- `nlu_service.py` imports from `app.core.nutrition_data` with zero imports of `cv2`.
- `vision_service.py` imports from `app.core.nutrition_data` preserving 100% backward compatibility for vision callers.

## 7. TECHNICAL CONSTRAINTS
- Zero changes to nutritional data values (calories, protein, carbs, fat, fiber).
- Pure Python dictionary with zero third-party dependencies.

## 8. ACCEPTANCE CRITERIA
- `python test_nlu_copilot.py` executes and passes cleanly without `cv2`.
- `vision_service.py` retains access to `VIETNAMESE_FOOD_NUTRITION`.

## 9. UNIT TESTS
- Unit test verifying nutrition lookup for "phở bò", "bún chả", "cơm tấm".

## 10. INTEGRATION TESTS
- Invoke Copilot chat with question *"Món này bao nhiêu calo?"*; verify nutritional response is generated.

## 11. REGRESSION TESTS
- Verify vision prediction model still references nutritional dictionary.

## 12. VERIFICATION COMMANDS
```bash
python test_nlu_copilot.py
```

## 13. ROLLBACK CONSIDERATIONS
Revert import in `nlu_service.py` to `vision_service.py`.

