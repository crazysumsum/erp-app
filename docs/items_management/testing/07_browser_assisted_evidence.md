# Browser-Assisted Verification Evidence

## Identity

- Executor: primary TEST_AND_VERIFY agent using `playwright-cli`
- Time window: `2026-09-14T09:33:56Z`–`2026-09-14T09:41:24Z`
- Candidate: `49d487e876932e6684cbdbec46043312b3f730bd`
- Runtime: local Headless Chrome 152; frontend `127.0.0.1:4173`; API `127.0.0.1:3000`; synthetic MySQL `erp_dev`
- Classification: supporting browser evidence only; not the absent configured UAT suite and not business acceptance.

## Observed flows

| Flow | Result | Observable evidence |
|---|---|---|
| Initial login with wrong CORS test configuration | EXPECTED_ENV_FAILURE | Browser showed recoverable network error; preflight was blocked and request failed. API restarted with exact test origin rather than changing product code. |
| Login and device binding | PASS | Valid credentials produced 403 pending-device state, UI displayed truncated device ID, exact local binding was approved, second login returned 200 and navigated home. |
| Item navigation and permissions | PASS | Item Management menu showed Item/SKU, Category, Brand, UOM, Attribute, Import/Export and Audit. |
| Item list empty/search/refresh | PASS | SKU list returned 200; empty state was visible; `q=NO_SUCH_SKU_T44` appeared in URL and survived reload. |
| Standard Item invalid submit | PASS_WITH_OBSERVATION | Empty draft submit returned 400 and rendered page/form alerts with invalid fields; no data persisted. Chrome logs failed-resource 400 as a console error, matching the deliberately induced error response. |
| Variant Item entry | PASS_WITH_LIMITATION | Switching to Variant showed shared SKU fields and actionable missing variant-attribute guidance. No category/attribute fixture was created, so combination generation and existing-Item SKU addition were not executed. |
| Dirty-state navigation | PASS | Navigating away after changing the create mode raised `beforeunload`; accepting it completed navigation without silent loss. |
| Import/Export and Audit pages | PASS | Pages rendered expected controls/empty states; API requests returned 200. |
| `item.mgmt`-only read access | PASS | Dedicated role contained only `item.mgmt`; account could read Item list, Brand catalogue and Item Audit, and saw all Item Management navigation with no User Management access. |
| `item.mgmt`-only write/audit | PASS | Brand create returned 201; unreferenced delete with password/reason returned 200; Audit displayed create/delete actor and cleanup reason. |
| Final console/network | PASS | Final successful Item/Audit journeys had 0 console errors and 0 warnings; relevant API requests returned 200/201. The only final browser note was a verbose autocomplete suggestion on a password field. |

## Retained artifacts

- `testing/evidence/item-create-validation.png`, SHA-256 `e13666bca52d662c9b260955ddf06a8f5b4083da4a72e8ab6676fc77867cf3ad`
- `testing/evidence/item-mgmt-only-audit.png`, SHA-256 `fa7163674c40b3d0cf212fd202fac269fdeb29d1ba91ab6d5d3ab1325d7d9a6a`

## Cleanup

- Deleted temporary Brand `QA T44 Mgmt Only Brand` through the UI.
- Removed temporary users 17059/17060, device bindings 4121/4122, dedicated role 13265, token/role linkages and the two temporary audit rows after screenshots were captured.
- Verified remaining temporary QA users/role/Brand counts are all zero.
- Closed browser; stopped client/API; released advisory lock `erp-item-task044-local-20260914` (`RELEASE_LOCK=1`).
