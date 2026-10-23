# Sprint 01 — PR B 與 Antigravity QA handoff

## 範圍與目前判定

UX-03：semantic table、SGT、維持後端順序與三種既有狀態、單一 New Draft / Refresh、可水平捲動手機表格、載入/空/錯誤、鍵盤焦點保留。
UX-04：卡片大型 Manage Project 改為 labelled ⋯ dialog 入口；既有 visibility / archive / delete callable、權限與 delete confirmation 不變。生命週期視窗標題、關閉、說明與響應式間距改善。

PR B 以新 Sprint PR A 為 base；兩者來源為 main b3b7a51，未採用舊 V2.3 分支。不得 merge 或 deploy。

**Implementation：已實作；Tests：HOLD（3 個原始碼雜湊）；Deployment：NOT DEPLOYED；User acceptance：NOT RUN。**

原始碼獨立檢查：Codex reviewer 發現 A 換週往返取消、B refresh 焦點兩項 P2，均已修正；此檢查不是 Antigravity 最終瀏覽器 QA 或 Control Plane Gate。

## Reproduce locally

Node 22+、Java 21、既有 root/functions/pdf-service lockfile dependencies：各目錄 `npm ci`。不下載 Artifact Registry images。

啟動：`firebase emulators:start --only auth,firestore,functions --project demo-pm-dashboard-v22t --config firebase.v231-e2e.json`。
設定 `GCLOUD_PROJECT=demo-pm-dashboard-v22t`、`FIRESTORE_EMULATOR_HOST=127.0.0.1:8188`、`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9198`，以及自行選擇的 `SPRINT_TEST_PASSWORD`。測試腳本僅接受此 demo project 與 localhost endpoints；會重置該模擬器的合成資料，不得與其他模擬器任務同時跑。

- `node scripts/verification/ux-sprint-01-browser.mjs --baseline`：從固定 main SHA git archive 建立 baseline。
- `node scripts/verification/ux-sprint-01-browser.mjs`：20 samples × 4 entries × 2 roles × 2 delay conditions。結果在 `tmp/ux-sprint-01/candidate/`。
- `node scripts/verification/ux-sprint-01-browser.mjs --functional`：真實 SDK/模擬器瀏覽器案例與 screenshots，結果在 `tmp/ux-sprint-01/flows/`。
- 腳本服務運行時為 `http://127.0.0.1:4198/?emulator=1&firestorePort=8188&authPort=9198&functionsPort=5108`。
- 手動瀏覽可先 build prod，再於該產物提供本機 static server。保留同一 emulator URL 參數。

測試帳號：`sprint.admin@example.test` (Admin)、`sprint.pm@example.test` (PM)、`sprint.other@example.test` (另一位 PM)、`sprint.vip@example.test` (VIP)。全部為本機合成帳號；密碼由上述環境變數注入，報告不保存憑證。Fixtures：W30–W43、SOURCE / PUBLISHED / DRAFT、兩份儲存草稿；不含真實業務資料。

## Antigravity bounded final browser QA（尚未派送／未執行）

前置：三個受保護 frozen hash 測試取得合法更新核准，兩個 exact head 的 CI 全綠後，才開始最終 QA。不得把本 handoff 當 PASS。

1. 四入口 Admin/PM：立即 shell、等待明確、資料正確；檢查 timing marks，取消/換週往返/登入轉換後舊回覆不得開窗。
2. Draft save 與 Publish：成功確認後關窗 toast；真實 conflict / permission / validation，以及注入 network failure；值保留、可重試、無假成功。
3. 連點、慢 list refresh、pending 換週；額外驗證 pending 登出/再登入、後端成功但回覆遺失、拖曳排序鎖定。後三者尚無完整獨立 browser acceptance，不宣稱已覆蓋。
4. My Drafts：欄位/順序/SGT/已發佈vs待發佈變更、空/載入/錯誤、New Draft、Refresh/Load more focus、Tab/Escape、390px 橫向捲到 Actions。
5. Admin/PM/delegated PM/VIP：⋯ 權限、visibility Admin-only、delete capability、確認取消；實際 synthetic archive/restore/delete 與未授權 server denial。既有自動化覆蓋後端邏輯；完整本次 browser lifecycle 寫入矩陣仍待 QA。
6. Overview、Delivery Trends、PDF selection、Draft/Publish、Archive Recovery、Manage Weeks、User Permissions：對授權角色做實際 UI regression。

## 量測解讀與限制

基準與初版 PR A 原始數據在 evidence/。250ms 人工 callable delay 下，shell median 271–290ms → 5–22ms；editable median 仍約 283–286ms，source p95 約 538ms，後端確認等待未被省略。JS TaskDuration 為整段總 JS 時間；不等於單一凍結工作時間。此結果不代表雲端或正式資料 latency；小型 fixture 的改善不可外推大型專案。

新版 table 390px 以可鍵盤焦點的區域水平捲動；整頁既有 header 在窄屏仍有 overflow，此 Sprint 未重設整頁導覽。

## Required CI / release boundary

Root、Rules、PDF（含 CI Docker local build）、sync-boundary、prod/uat Hosting builds。A 已觀察 GitHub 4/5 成功，root-tests 因三項原始碼 frozen hash 失敗。Hash 預期值保持原樣：自動核准審查拒絕更新，理由是可能掩蓋未授權廣泛變更。需要明確核准合法更新後重新取得 exact-SHA CI；不提供繞過方式。

建議 UAT：先解除上述阻礙、Antigravity QA 與 ChatGPT Gate；再提出單獨的 Hosting-only UAT 部署授權，綁定候選 SHA/設定/環境，準備原 Hosting release 回復方法。驗證 UAT 使用者旅程後才討論 Production readiness；本任務未授權任何部署、合併、Functions/Rules/PDF/IAM/billing 變更。

本地最終組合驗證：root 1,793 pass / 3 skip / 3 frozen-hash fail；focused 20/20、prod/uat Hosting build、sync-boundary、package parity passed。Rules/PDF 共用未變更部分沿用本次 A 的 50/50、551/551 證據。最新 browser results 與桌機/390px screenshots 見 evidence/pr-b-* 及 after-*。測試曾因登入後週次 snapshot 尚未到達而正確取消開窗；測試已改為等待 W43 就緒，不以更改 runtime 規則消除此等待。
