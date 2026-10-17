# New Project Draft / Publish Implementation Plan

Agent: Codex
Model: GPT-6.1 Sol（建議執行模型，非已使用模型的聲明）
Reasoning/Effort: High

Why this route: 保留目前程式脈絡，以單一執行者處理相依介面，並對權限與發布交易做獨立最終審查。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新專案及其後續工作稿持久保存，只有明確 Publish 的內容才進入目標未發布週的 Overview 與正式報表。

**Architecture:** 使用獨立 projectDrafts 集合與 server-authorized callable，草稿不進入 weeks.projects。Publish 以 transaction 更新正式週專案及發布紀錄；既有週讀取／PDF／統計繼續只取得正式快照。只在 UAT 啟用，Production 保持原行為。

**Tech Stack:** 現有 ES modules／HTML、Firebase Functions v2／Admin SDK、Firestore Rules、Node test runner、Firebase Emulator；Functions 沿用 Node 22，不新增框架。

**Spec:** [已確認的設計](../specs/2026-10-14-new-project-draft-publish-design.md)

## Global Constraints

- 本次針對「經新流程新增的專案」實作上述完整生命週期。
- 既有專案維持目前流程，不批次轉成 Draft、不重新解讀缺少新欄位的歷史資料。
- Archive 與 Release Week 保留原有意義；先前提出的細粒度 Archive 權限不是本次實作範圍。
- 本次不新開放所有 PM 新增專案。
- 原始週的 client write 仍拒絕。既有 Production Rules 不放寬。
- Draft 永遠不合併到 allWeeks 或供 Overview 計算的集合。
- 本次以 UAT 功能實作、UAT build、本機 emulator、測試及未部署的 Draft PR 為交付範圍。
- 不直接 merge、deploy、建立雲端 runtime identity 或授予 IAM。
- 獨立分支 `codex/new-project-draft-publish`，基準 `4a8e7ee63cdf40c3699c834b5ff18c7427e307b0`；共享 checkout、V2.3 分支、sources/ 均不修改。
- 執行前讀 using-git-worktrees，確認目前 isolated checkout 適合延續；若需新 checkout，保留已確認 spec／plan，不覆寫別人的變更。
- 採 Native：目前 Codex 逐項實作；最終以獨立審查者檢查整個分支。建議以 GPT-6.1 Sol High 審查，只有證據不足才升級；不需要使用者協調代理。

## Review Focus

1. 從舊分頁送出的 isNew:true 或 attention/risk 修改不能繞過 Publish（Task 4）。
2. Publish 已提交但瀏覽器逾時，重試不可重複建立專案或稽核（Task 3、5）。
3. 跨週 copy／Production→UAT restore 的同 code 專案不得被錯誤接管（Task 3、6）。
4. Admin 重新指定成員、權限撤銷或帳號切換後，舊請求不能更新舊帳號畫面（Task 2、5）。
5. 只剩 Draft／沒有任何未發布週時，仍能保存工作稿，不能出現假統計或自動重開週（Task 5、6）。

---

## File structure and contracts

New server files: `functions/project-drafts-core.js`（純驗證／權限／狀態）、`functions/project-drafts.js`（callable、查詢、transaction）、`functions/draft-environment.js`（UAT runtime gate）。

New browser files: `js/project-drafts-api.mjs`（API adapter）、`js/project-drafts-controller.mjs`（草稿 session／請求失效）、`js/project-drafts-ui.mjs`（My Drafts DOM）。`index.html` 只加入必要容器、靜態 import、既有 editor 接線，不另重構大型畫面。

Modified: `functions/index.js` exports、`functions/project-dashboard-writes.js` 舊入口防護、`firestore.uat.rules`／`firestore.shared-backend.rules` 明確草稿拒絕、`firestore.uat.indexes.json` 列表索引；`firestore.rules` 僅在需要時新增明確 deny，禁止放寬既有權限。其他檔案依下列驗收需求做最小修改。

**DraftRecord:** `{schemaVersion:1,draftId,project,editorEmails,assignment:{ownerEmail,deputyEmail},revision,createdAt,createdBy,updatedAt,updatedBy,publicationTargets,lastPublication:null|{weekId,draftRevision,publishedAt,publishedBy,projectRevision}}`。`assignment`／ACL／metadata 由 server 驗證並產生；UI 不能直接指定 ACL。`publicationTargets` 是 server-only `{[weekId]:{draftRevision,projectRevision}}`，保存每個曾發布目標的對照；即使正式專案被刪除也不清除，防止舊Draft被誤判為首次發布而重建。get/list回傳DTO只需lastPublication，不回傳這份內部對照。

**Published project:** 既有 project payload 加上 `{publication:{draftId,draftRevision,publishedAt,publishedBy}}`，不包含 editorEmails 或草稿內容。保留原有 project revision fingerprint 演算法。

**API data:** `save({draftId?,expectedRevision,project,assignment?})`；新案 expectedRevision=0、server 產生 draftId，既有案需匹配 revision。`assignment` 只讓 Admin 指定目錄內 PM 成員；PM 新案 owner 由 server 設本人，既有案不接受成員變更。`project.owner/deputy` 由驗證後的 assignment 產生，拒絕與 server 決定不符的輸入。

`list({limit:25,cursor?}) -> {drafts,nextCursor}`；`get({draftId}) -> {draft}`；`save(...) -> {draft}`；`publish({draftId,expectedRevision,weekId,expectedPublishedRevision:null|string}) -> {weekId,project,projectRevision,draftRevision,publishedAt,alreadyPublished}`。首次發布 null 表示目標週不存在該案；如已存在不同 draftId 即衝突。

所有 client payload 使用封閉欄位白名單；日期為 server 產生的 UTC ISO 字串，不能由 client 送入。暫不提供刪除草稿、自動發布、Draft PDF、草稿雲端同步。

### Task 1: Draft contract, identity and runtime gate

**Files:** Create `functions/project-drafts-core.js`, `functions/draft-environment.js`; test `functions/test/project-drafts-core.test.cjs`, `functions/test/draft-environment.test.cjs`.

**Interfaces:** `assertDraftEnvironment(env)->void`；`assertDraftAccess(actor,draft,action)->void`；`validateDraftInput(project,{publishing}) -> normalizedProject`；`buildDraftRecord({actor,existing,input,assignmentUsers,draftId,nowIso})->DraftRecord`。actor 使用既有 server-read 角色／override 結構；action=`read|save|first-publish|republish`。

- [ ] 寫失敗測試：Admin 全部可管理；有 project.manage 的 PM 可新建；無 grant PM 不可新建；自己的既有草稿可保存；他人／匿名／非 PM／malformed role 拒絕；PM 不可改 ACL、code（首次發布後）、visibility 或負責人。
- [ ] 寫邊界斷言：空 name/code 草稿可保存但 Publish 拒絕；progress=0/100 合法，-1/101/NaN/字串拒絕；沿用現有 maxBytes=256KiB、maxDepth=8、maxArrayEntries=2000、maxObjectKeys=2000、maxStringLength=20000，發布名稱／code 使用既有必要欄位驗證。
- [ ] 寫 runtime 測試：只有 `GCLOUD_PROJECT`／`GOOGLE_CLOUD_PROJECT` 精確 UAT `pm-dashboard-uat-20260820-a7f3` 可執行；Production、缺值、相互矛盾 ID 拒絕。Emulator 只在 `FUNCTIONS_EMULATOR=true` 且 project ID 精確 `demo-pm-dashboard-v22t` 時允許，不接受 request 帶入環境。
- [ ] 執行 `node --test functions/test/project-drafts-core.test.cjs functions/test/draft-environment.test.cjs`，確認缺少模組／行為而失敗；再實作上述函式並重跑至全綠。
- [ ] Commit：`feat: define UAT project draft contract and authority`。

### Task 2: Authenticated draft storage and Rules isolation

**Files:** Create `functions/project-drafts.js`, `functions/test/project-drafts-callables.test.cjs`; modify `functions/index.js`, `firestore.uat.rules`, `firestore.shared-backend.rules`, `firestore.uat.indexes.json`; test `tests/firestore-rules-emulator.uat.test.mjs`, `tests/firestore-rules-emulator.test.mjs`.

**Interfaces:** export callable `listDashboardProjectDrafts`, `getDashboardProjectDraft`, `saveDashboardProjectDraft`; use Task 1 contracts。各呼叫 server 讀 users 與 userPermissions；get/save 在 transaction 中重新讀 ACL。PM list 查 `editorEmails array-contains actor.email`，Admin 可讀全部；依 updatedAt desc、documentId 穩定排序，limit 1–25，cursor 驗證綁定 actor，不讓 PM cursor 接管 Admin 查詢。

- [ ] 用既有 permission callable 的 in-memory transaction 測試模式建立實際 handler 測試；斷言 save 不寫任何 weeks 文件、CAS 衝突不改資料、PM 名單不含他人、頁面最多25筆、不重複漏頁、猜 ID 拒絕且不洩漏內容。
- [ ] 增加撤銷測試：Admin 重指派成員後，舊 actor 即使知道 revision 也不能 get/save；同名不同 email 不視為同一人；client forged metadata／未知欄位／expectedRevision 錯誤拒絕。
- [ ] 在 Rules emulator 以合成文件測試所有角色對 projectDrafts／projectDraftPublicationAudit 的 get/list/write 均拒絕；原有 users／weeks／permissions 權限回歸保留。Production rules 也確認未知草稿集合不可讀。
- [ ] 執行相關 tests 確認先失敗，再實作查詢、transaction 及 UAT composite index；用 `onCall` 現有配置模式，新增專用 `pmdash-project-drafts@` runtime identity 宣告與 service-account source test；不建立真實 identity／IAM。
- [ ] 執行 `node --test functions/test/project-drafts-callables.test.cjs` 及 `npm run test:rules`。預期 callable 全綠、三種 Rules 設定拒絕測試全綠；emulator 未跑不得記為 PASS。
- [ ] Commit：`feat: persist access-controlled project drafts`。

### Task 3: Transactional Publish with revision and history guards

**Files:** Modify `functions/project-drafts-core.js`, `functions/project-drafts.js`, `functions/index.js`; create `functions/test/project-draft-publication.test.cjs`.

**Interfaces:** `planDraftPublication({actor,draft,week,input,nowIso})->{project,weekPatch,draftPatch,audit,alreadyPublished}`；callable `publishDashboardProjectDraft` 使用 File structure 的 publish API。純 planner 不執行讀寫；handler 一次 transaction 讀 actor、草稿及目標週，再寫週、草稿 lastPublication／publicationTargets、server-only audit。Save不得改寫publicationTargets；曾發布目標的正式專案已不存在時回conflict，不自動重建。

- [ ] 建立 fixture 正式 ALPHA=40%、Draft=65%；斷言只有 Publish 改目標週到65，其他週維持40，草稿仍存在，editorEmails 不進正式快照。首次 Publish 驗證 name/code、Active visibility 與必要歸屬，使用者不能藉此直接 Archive。
- [ ] 失敗案例：released week、不存在週、草稿 revision 過期、目標正式 revision 過期、同 code 不同 draftId、legacy 同 code、無 grant 首次 Publish、移除 PM 角色、重新指派後不符合正式歸屬，全部不產生部分寫入。
- [ ] 重送案例：相同週／draft revision／正式內容一致回 alreadyPublished=true，audit 數量不變；若 target 被 restore 或刪除，不可錯誤重用上次成功紀錄。單一已知 draftId 在同週出現多次視為衝突，不選第一筆覆寫。
- [ ] 跨週案例：Active carryover 帶 publication metadata 但不帶草稿；新週匹配 draftId 可再次發布，較早週不變；相同 code 但 identity 不同拒絕。
- [ ] 執行 `node --test functions/test/project-draft-publication.test.cjs` 確認失敗，再實作 planner 與 callable。handler 先完成所有 transaction reads 再 writes，audit.create 失敗整次回滾，採已使用的 optimistic project fingerprint。
- [ ] 重跑上述測試及 `functions/test/week-carryover-parity.test.cjs`、`functions/test/project-dashboard-revision-parity.test.cjs`。Commit：`feat: publish draft snapshots atomically`。

### Task 4: Prevent legacy writes from bypassing Draft / Publish

**Files:** Modify `functions/project-dashboard-writes.js`, `index.html`; tests `functions/test/project-dashboard-writes.test.cjs`, `functions/test/project-visibility-authority.test.cjs`, new `functions/test/project-draft-write-boundary.test.cjs`.

**Interfaces:** `assertLegacyProjectWriteAllowed({environment,existingProject,isNew})->void` in `functions/draft-environment.js`；UAT 舊 isNew=true 拒絕，具 server publication.draftId 的舊一般內容／attention 修改拒絕，reason=`draft-publish-required`。Production及legacy專案保持原行為。

- [ ] 寫實際 callable 測試：舊分頁直送 isNew:true 拒絕；PM／Admin 都不能對 managed project 走舊 Save／attention 改正式內容；偽造／移除 publication 或改成另一 draftId 不可繞過，授權判斷用原始文件。
- [ ] 對照測試：Production create/edit、UAT legacy edit 正常；既有明確管理權的 delete、Admin visibility 保留。刪除不會讓舊 draft 再發布時自動重建，需 Admin 明確處理，此次回衝突。
- [ ] 執行 `node --test functions/test/project-draft-write-boundary.test.cjs` 確認失敗，再實作防護。Publish 不透過允許 client 切換的 bypass 參數；只在新的 server handler 內建立正式 patch。
- [ ] 盤點並接線主 editor、`saveCurrentWeekQuietly()`、risk 快捷、attention、weekly one-paste：managed project 導向 My Drafts；不適合即時轉入者明確顯示「Edit in My Drafts, then Publish」，且不顯示 Saved。Legacy 維持原流程。
- [ ] 重跑 project writes／visibility／write-boundary tests 與既有 `tests/weekly-update-paste-ui.test.mjs`。Commit：`fix: enforce publication boundary across project writes`。

### Task 5: My Drafts and Save / Publish UI

**Files:** Create `js/project-drafts-api.mjs`, `js/project-drafts-controller.mjs`, `js/project-drafts-ui.mjs`; modify `index.html`; create `tests/project-drafts-api.test.mjs`, `tests/project-drafts-controller.test.mjs`, `tests/project-drafts-ui.test.mjs`.

**Interfaces:** `createProjectDraftsApi({functions,httpsCallable})->{list,get,save,publish}` 使用 Task 2/3 callable 名稱；`createProjectDraftsController({api,onState})` 提供 `setIdentity({uid,email}|null)`, `refresh({cursor?})`, `open(draftId)`, `save(input)`, `publish(input)`, `reset()`；state 與 allWeeks 完全分開。`mountProjectDraftsUi({root,controller,onEdit,onPublished})->{render,dispose}` 用 DOM/textContent、不拼接不可信 HTML。

- [ ] 寫 adapter 測試確認精確 callable 名稱／payload／錯誤傳遞。controller 測試確認 stale response 不更新新帳號、reset 清空、保存不觸碰 allWeeks、Publish失敗保留工作稿。
- [ ] 寫 UI 行為測試：New Project → Draft；My Drafts 有 Never published／Unpublished changes 狀態、手動重新整理／分頁；Save Draft 與 Publish 分開；未保存內容需先保存；成功顯示來源週次／發布時間，不自動關掉失敗的 editor。
- [ ] 加入目標週選擇與版本讀取：只列 actor 原本可存取且未發布週；無符合週時 Save 仍可用，Publish 停用並說明，不能自動建立／重開週。Server仍獨立驗證。
- [ ] 權限：Admin 可指定 users 目錄中 PM 的 owner/deputy；PM 的身分欄位鎖定。既有 project.manage 開關控制 New Project／首次 Publish，後續 Publish 依既有歸屬與草稿 ACL 顯示。
- [ ] 實作 API／controller／UI及 editor session接線。UAT runtime flag 決定是否使用新流程；Production所有入口保持原樣，新模組可被靜態 asset collector 打包但不發送 draft 請求。
- [ ] 執行 `node --test tests/project-drafts-api.test.mjs tests/project-drafts-controller.test.mjs tests/project-drafts-ui.test.mjs tests/project-list-editor-ui.test.mjs tests/project-list-editor-ui.uat.test.mjs`。用本機合成資料瀏覽器 smoke 驗證：保存、重載、換週、Publish、40→65隔離、錯誤保留。Commit：`feat: add UAT My Drafts editing and publishing`。

### Task 6: Overview / PDF / Trend / carryover and environment regressions

**Files:** Create `tests/project-draft-isolation.test.mjs`; extend `tests/portfolio-core.test.mjs`, `tests/copilot-weekly-update-prompt.test.mjs`, `tests/hosting-build.test.mjs`, `tests/dashboard-profile-invariants.test.mjs`, `functions/test/production-week-sync-boundary.test.cjs`, `pdf-service/test/report-data.test.mjs` only where meaningful behavior assertions belong.

**Interfaces:** Existing official read models remain based on weeks.projects；任何新 `publication` 欄位不改既有 normalize／report contract。不為了讓測試通過而重寫 Production baseline 或移除其檢查。

- [ ] fixture：兩個正式專案 20%、60%，一個未發布 Draft100%／red／高預算；斷言 Overview total=2、平均40%、風險與預算值等於原基準，趨勢／PDF selection／Copilot不含Draft名字或內容。零正式專案＋有Draft仍是空狀態。
- [ ] fixture：正式40%、工作稿65%；Save→正式報表40，Publish→目標週65；較早已發布週仍40。正式 PDF 不接受 draftId 作 projectCode，不提供 Draft PDF。
- [ ] createWeek僅複製正式快照，Draft留原集合；sync／restore操作不寫 projectDrafts，不因 restored同code接管。對 managed ID 的衝突由Task3測試保證。
- [ ] 執行以上 targeted tests，必要時做最小相容修改；預期原統計與報表演算法不需修改。
- [ ] 執行 `npm run build:hosting:uat`，再 `npm run build:hosting:prod`；兩次各自保留 build 驗證結果。Production runtime不啟用Draft，UAT build只綁UAT資源；不執行deploy腳本。
- [ ] 執行 `npm run test:all`、`npm --prefix pdf-service test`、`npm run test:rules`、`npm run verify:sync-boundary`、`git diff --check`。檢查實際skip，不把emulator未執行算通過；若既有失敗先在乾淨基準重現並分開記錄。Commit：`test: verify draft isolation and production compatibility`。

### Task 7: Independent review, acceptance report and Draft PR

**Files:** Create `docs/reports/2026-10-14-project-drafts-uat-validation.md`；必要的部署前置說明放 `functions/README.md`。本機截圖／合成fixture可放報告附件；不得把Production內部專案資料放進公開PR。

**Interfaces:** 報告逐項對應spec驗收1–12，狀態=`PASS|FAIL|NOT_RUN|HOLD`；清楚區分本機emulator、UAT build、GitHub CI、真實UAT驗收與部署。

- [ ] 自查最終diff與spec覆蓋，讀 verification-before-completion，依實際結果記錄執行命令、測試數、失敗／skip、commit與畫面證據；不得把原49項baseline通過當成功能驗收。
- [ ] 以requesting-code-review流程安排一次獨立安全審查，重點為ACL、原子性、旁路、跨週身分、UAT gate及Production回歸。此plan明確要求最終獨立review，不委派重複實作；使用者不需轉送訊息。
- [ ] 修復review問題，僅重跑受影響測試及必要整合；未解安全問題標HOLD。
- [ ] 列出 dedicated service account `pmdash-project-drafts@` 的UAT部署前置：users／userPermissions讀取、projectDrafts讀寫、weeks讀寫、publication audit建立；既有寫入identity無需因這個功能擴權。實作不執行IAM變更、雲端發布或真實角色grant。
- [ ] 建立Draft PR到`augusliang23-web/pm-dashboard`，標示UAT功能與未部署；PR body說明Draft/Publish行為、legacy範圍、驗證結果與live驗收限制。所有建立的PR呼叫attach_artifact。
- [ ] 檢查該HEAD的CI結果；如需執行未授權雲端動作／真實資料測試才能完成的項目，一律NOT_RUN/HOLD。交付PR連結、報告及下一步，不能稱READY FOR PRODUCTION／DEPLOYED。

## Self-review and approval checkpoint

已對照spec 1–10節：持久工作稿Task1/2/5；發布與歷史Task3；權限／旁路Task1/2/4；所有統計出口Task6；錯誤與帳號切換Task5；UAT環境／runtime identityTask1/2/6/7；所有驗收條件均有對應步驟。Review Focus五項已加入各任務測試。

執行環境若沒有Node22或可用emulator，先定位既有runtime／依package lock安裝測試依賴；不得變更Functions Node22 floor或用skip掩蓋。缺乏runtime／IAM不是自動部署或擴權理由。

本計畫目前只完成撰寫與自查，所有任務checkbox保持未完成。請使用者審閱計畫並確認Native執行方式，再進入實作。
