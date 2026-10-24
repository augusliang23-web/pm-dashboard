# UI/UX Improvement Sprint 01

## Product Contract（Owner 執行範圍，2026-10-23）

使用最新 main `b3b7a51d5db680cfc87acdf24d06d73a9de2aaac`，原生 HTML/CSS/JS。Admin / 有編輯權的 PM 從 Dashboard、My Drafts、已發佈專案或既有草稿進入同一個編輯器；立即回應、明確顯示等待，後端確認發佈成功才關閉並通知。失敗保留輸入、顯示錯誤並可重試。My Drafts 改為響應式表格；卡片管理入口降低顯著程度，保留角色限制與生命週期操作。

不改查詢範圍、授權、交易、版本驗證、週次限制、Rules、Functions、PDF、IAM、billing。不使用真實業務資料；不 merge、不部署。最終獨立瀏覽器 QA：Antigravity；Gate 決定：ChatGPT。

## Tracked tasks

| Task | Owner requirement | Root cause / proposed change | Verification | PR | Final status |
|---|---|---|---|---|---|
| UX-01 P0 | Edit Project 開啟延遲 | 開窗前串行等 callable；Admin 再讀 users。先顯示安全的空白 shell；沿用當次登入已載入的 PM 目錄，保留 auth/open generation 檢查 | baseline / candidate median、p95、真實模擬器 browser；取消、換週、換帳號 | [PR74](https://github.com/augusliang23-web/pm-dashboard/pull/74) | 實作及本機驗證通過；獨立 QA 待辦 |
| UX-02 P0 | Publishing 回饋、成功關窗 | 現有成功路徑只 toast；補 busy 文案、確認後關窗，列表更新不阻塞；錯誤保留表單 | conflict/permission/network/validation/duplicate/session/week/slow-refresh | [PR74](https://github.com/augusliang23-web/pm-dashboard/pull/74) | 實作及本機驗證通過；獨立 QA 待辦 |
| UX-03 P1 | My Drafts table | 重複說明與垂直 article；改 semantic table、SGT、載入/空/錯誤、單一 New Draft | 真實資料映射、排序、keyboard、390px、隔離 | B 待建立 | 待實作 |
| UX-04 P1 | 移除卡片冗餘 Manage Project | 同一卡片 Edit + 大型 Manage；將既有管理操作放在低顯著、可鍵盤操作入口 | Admin/PM/delegated/denied、visibility/archive/delete/confirm、dialog focus | B 待建立 | 待實作 |

## Implementation plan

1. 固定 baseline，執行 root 測試；建立同一組合成 emulator fixtures 與重複瀏覽器量測。保留原始數據與測試條件。
2. PR A：先建立會失敗的開窗/成功/錯誤/競態測試，再補最小前端更動。使用現有 editor、controller、後端 callable。新增只含時間的 performance marks，無私人內容。
3. PR B：基於 main 的獨立分支，僅 My Drafts table、SGT 格式與管理入口/版面；Edit 委派既有 public handler，使 PR A 合併後自然採用較快流程。以兩者合成候選額外驗證。
4. 分別完整 CI、自我 diff 檢查；準備兩個 Draft PR 與 exact SHA、screenshots、fixtures、操作腳本、限制。Antigravity 的獨立最終 QA 不以 Codex 自我驗證取代。

## Acceptance / review focus

- 所有入口 shell feedback 目標 <100ms，完成可編輯前不暴露舊資料；不得以 spinner 宣稱解決延遲。
- 舊請求不能重新開啟已取消/換週/換登入的 editor；同時 list refresh 不可取消發佈交易結果。
- 成功後慢 refresh 不阻塞關窗；未知/失敗不關窗、不假成功。Pending 表單避免新輸入被成功關窗丟棄。
- 使用現有三種 publication state；不得以 draft progress 冒充 published progress。
- 管理入口不提供額外權限；visibility Admin-only，delete capability、確認、archive recovery 保留。

## Execution ledger

- main verified with GitHub and `git fetch origin main`; working tree clean and isolated.
- Baseline root: 1,777 passed, 3 existing skips, 0 failed (1,780 total).
- PR A / B implementation、CI、Product Acceptance：尚未完成。
- Deployed UAT / Production acceptance：NOT RUN；此任務不授權部署。

## PR A evidence (local, synthetic)

- Focused 25/25; complete suite 1,786 pass / 3 skip / 3 fail. The failures are the existing exact UAT HTML hashes in role-contract (1) and delivery-trends-integration (2); expected values remain unchanged after automatic approval rejected changing them. This is HOLD, not a CI pass.
- 17 actual Chromium + Auth/Firestore/Functions emulator scenarios passed (Admin 8, PM 9): cancel pending open, real revision conflict, network failure/retry, real publish validation, duplicate click, slow list refresh, real PM permission denial, pending week change, Save Draft persistence/reload, Overview/PDF selection. Browser results distinguish fault injection from actual callable cases in the script.
- Controlled benchmark: Chromium headless, 1440×1100, CPU 1×, 20 samples for each of Admin/PM × four entry points × 0/250ms added callable delay; 320 samples per source. Synthetic W30–W43 / two drafts / four users. This is not deployed/cloud latency.
- With 250ms added wait: baseline shell medians 271–290ms, p95 279–530ms; candidate shell medians 5–22ms, p95 15–25ms. Source-project ready p95 remains ~538ms (network-dominated outlier); no claim of faster backend service. Most editable medians remain ~283–286ms because the authoritative read is still required. Exact distributions: evidence JSON.
- JS TaskDuration is the total browser JS during the click→ready interval (not a single blocking task). Main cost is the mandatory callable; Admin's repeated users read was removed by reusing the authenticated directory. No draft data cache was added.
- Feedback benchmark is first visible editor frame; baseline My Drafts separately disabled/rebuilt its action row while waiting. No claim that every old My Drafts click lacked feedback.
- Native performance marks: `pm-editor:click/shell/data/hydrate-start/ready`; measures `feedback/backend/hydrate/editable`. Only timings; no identities or draft values. Open generation and auth/week checks cancel stale results.
- Backend permission errors keep the current form; unauthenticated/auth-transition still invalidates private editor state. Publish freezes form fields while pending so success-close cannot discard newly typed values; Save Draft continues allowing later typing and retains the submitted dirty baseline.
- Hosting prod/uat, sync-boundary and delivery-trends package parity passed. No backend code, security rules, deployment configuration or cloud data changed.
- Source review P2: pending open on W43→W42→W43 could become current again. Fixed navigation cancellation, RED→GREEN regression and actual browser round-trip. 19 browser scenarios now passed, including actual logout/login persistence; disabled+inert fieldset blocks pending publish edits/reorder. Rules 50/50 and PDF 551/551 passed.
- PR A: https://github.com/augusliang23-web/pm-dashboard/pull/74 (Draft, HOLD on 3 frozen source hashes).
- Packaging ruling: PR B will target the new Sprint PR A branch so its table can directly reuse UX-01. This is a new bounded Sprint stack rooted at latest main, not any old V2.3 stack. No merge authorization; rebase/retarget B to main only after a separately authorized A merge.

## S01 PR74 unblock (2026-10-24)

See [PR74_UNBLOCK.md](PR74_UNBLOCK.md). Original three historical hashes are unchanged; exact context-checked source reversal plus fail-closed negative tests replaces a blanket hash refresh. Current permission-loss handling retains PR78 semantics. PR75 stays untouched and must be reconciled later by its owner. Deployment, Product Acceptance and final Antigravity QA remain outside this task.
