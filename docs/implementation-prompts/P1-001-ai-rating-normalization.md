# IMPLEMENTATION PROMPT: P1-001 – AI FOODY RATING SCALE NORMALIZATION (FIX 5.4★ BUG)

## 1. OBJECTIVE
Normalize Foody 10-point scale ratings into standard 5-star ratings during MongoDB dataset loading in `KLTN-123-GastroWise-AI`, eliminating the invalid `"⭐ Đánh giá xuất sắc (5.4★)"` badge.

## 2. PROBLEM DESCRIPTION
MongoDB Atlas dataset contains restaurants scraped from Foody with `diemTrungBinh` on a 0–10 scale (98/178 restaurants have score $> 5.0$). NestJS divides raw ratings by 2 (`raw / 2.0`), but FastAPI `app/db/mongo.py:58` renames `diemTrungBinh` directly to `rating`. Consequently, `recommender.py:423` checks `if rating >= 4.7:` and assigns an excellence badge to mediocre venues (e.g. 5.4/10 = 2.7★).

## 3. SOURCE FILES TO INSPECT
- `KLTN-123-GastroWise-AI/app/db/mongo.py`: Lines 56–78.
- `KLTN-123-GastroWise-AI/app/core/recommender.py`: Lines 423–425.
- `KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts`: Lines 602–603 (Reference normalization logic).

## 4. FILES ALLOWED TO MODIFY
- `KLTN-123-GastroWise-AI/app/db/mongo.py`

## 5. FILES THAT MUST NOT BE MODIFIED
- `KLTN-123-GastroWise-AI/app/core/recommender.py`
- MongoDB database collections (Read-only!).

## 6. EXPECTED BEHAVIOR
- During `load_dataset_from_mongo()`, if raw rating $> 5.0$, it is scaled: `round(float(r) / 2.0, 1)`.
- If raw rating $\le 5.0$, it is retained as `round(float(r), 1)`.
- Maximum rating in memory never exceeds 5.0.
- A restaurant with score 5.4 becomes 2.7★ and does NOT receive `"⭐ Đánh giá xuất sắc"`.

## 7. TECHNICAL CONSTRAINTS
- Zero database write operations.
- Handle missing or null rating values gracefully with default 0.0 or 3.0.

## 8. ACCEPTANCE CRITERIA
- In AI memory DataFrame: `df['rating'].max() <= 5.0`.
- Restaurant "Cafe 280A" (raw 5.4) has `rating == 2.7`.
- `test_hybrid_recommendation.py` executes and passes with 100% assertions.

## 9. UNIT TESTS
- Add test function verifying that raw 5.4, 7.8, 9.2 scale down to 2.7, 3.9, 4.6 respectively.

## 10. INTEGRATION TESTS
- Call hybrid recommendation pipeline for user; verify generated reasons do not contain ratings $> 5.0$.

## 11. REGRESSION TESTS
- Run `python test_hybrid_recommendation.py`.

## 12. VERIFICATION COMMANDS
```bash
python -c "from app.db.mongo import get_dataset; df = get_dataset(); print('Max rating:', df['rating'].max()); assert df['rating'].max() <= 5.0"
```

## 13. ROLLBACK CONSIDERATIONS
Revert line in `mongo.py` that scales `rating`.

