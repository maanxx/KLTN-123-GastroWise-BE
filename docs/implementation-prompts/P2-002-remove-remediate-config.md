# IMPLEMENTATION PROMPT: P2-002 – UNTRACK REMEDIATE-CONFIG SCRIPT & SANITIZE CREDENTIALS

## 1. OBJECTIVE
Untrack and remove the committed script `scripts/remediate-config.js` in `KLTN-123-GastroWise-BE` which contains plaintext historical credentials for database user `thienthien`, and configure `.gitignore` to prevent future tracking.

## 2. PROBLEM DESCRIPTION
`KLTN-123-GastroWise-BE/scripts/remediate-config.js` was committed to Git HEAD. The script contains hardcoded MongoDB Atlas connection strings with plaintext credentials.

## 3. SOURCE FILES TO INSPECT
- `KLTN-123-GastroWise-BE/scripts/remediate-config.js`
- `KLTN-123-GastroWise-BE/.gitignore`

## 4. FILES ALLOWED TO MODIFY
- `KLTN-123-GastroWise-BE/.gitignore` (Add `scripts/remediate*.js`)
- `KLTN-123-GastroWise-BE/scripts/remediate-config.js` (Delete via `git rm`)

## 5. FILES THAT MUST NOT BE MODIFIED
- Any backend source code in `src/`.

## 6. EXPECTED BEHAVIOR
- `scripts/remediate-config.js` is removed from git index and disk.
- `.gitignore` ignores `scripts/remediate*.js`.
- No application runtime depends on this one-off remediation script.

## 7. TECHNICAL CONSTRAINTS
- Do not commit or push without user approval.
- Notify DBA to rotate/delete user `thienthien` in Atlas Console.

## 8. ACCEPTANCE CRITERIA
- `git status` shows `deleted: scripts/remediate-config.js`.
- `node` build and runtime tests execute without errors.

## 9. UNIT TESTS
- Not applicable (credential removal).

## 10. INTEGRATION TESTS
- Verify backend boots normally using `MONGODB_URI` from `.env`.

## 11. REGRESSION TESTS
- `npm run build` succeeds cleanly.

## 12. VERIFICATION COMMANDS
```bash
git -C KLTN-123-GastroWise-BE status
```

## 13. ROLLBACK CONSIDERATIONS
File can be restored from git history if required.

