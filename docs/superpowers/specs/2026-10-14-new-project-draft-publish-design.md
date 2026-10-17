# 新專案 Draft / Publish 設計

Agent: Codex
Model: GPT-6.1 Sol（實作建議，並非本次模型使用紀錄）
Reasoning/Effort: High

Why this route:
沿用既有程式脈絡，並以足夠的推理深度處理草稿隔離、發布交易及權限，避免跨代理重建脈絡。

日期：2026-10-14，Asia/Singapore。
狀態：待使用者審閱；尚未實作，尚未部署。
基準：`4a8e7ee63cdf40c3699c834b5ff18c7427e307b0`，獨立分支 `codex/new-project-draft-publish`。

## 1. 目的與範圍

新專案必須先保存為 Draft，由具備權限的 PM 持續編輯。只有明確執行 Publish，內容才成為某個未發布週次的正式專案資料，進入 Overview、統計、趨勢及正式報表。Draft 不隨換週遺失。

使用者已確認的邏輯：新案尚未 Publish 時不可出現在 Overview，進度百分比不可影響 Overview 數據；發布後繼續修改時，上次發布內容仍供 Overview 使用，工作稿不會提前生效。

本次針對「經新流程新增的專案」實作上述完整生命週期。既有專案維持目前流程，不批次轉成 Draft、不重新解讀缺少新欄位的歷史資料。Archive 與 Release Week 保留原有意義；先前提出的細粒度 Archive 權限不是本次實作範圍。

## 2. 方案選擇

選擇：將草稿保存於獨立的 `projectDrafts` 集合，Publish 才將經驗證的專案內容寫進既有 `weeks/{weekId}.projects`。沿用既有 Overview 及 PDF 的週資料來源。

不採用將 draft 標記直接放入原始週 projects 陣列的方案：這會讓未發布內容進入既有週讀取結果，並要求每個統計、PDF、Copilot、週複製入口都正確過濾；換週也容易產生多份工作稿。

不採用重建全部歷史專案的全新資料模型：本次無需遷移已發布內容。

這是新的資料與發布介面，屬架構性修改。此文件確認後才撰寫實作計畫。

## 3. 使用流程

### 新增與保存

1. 既有有權新增專案的使用者按 New Project，開啟標示 Draft 的編輯畫面。
2. Save Draft 僅保存工作稿，顯示成功時間。名稱或代碼尚未完成可先儲存；資料型別、大小、數值範圍仍須合法。
3. PM 在獨立的 My Drafts 工作區找到可編輯的草稿，看到 Never published 或 Unpublished changes。Admin 可管理全部草稿。
4. My Drafts 不受週次切換、Overview 搜尋或分類篩選影響；可以明確重新整理。重新登入仍可讀回草稿。
5. 不新增自動發布或模糊的 Save and Publish。離開未保存的編輯器時沿用既有未保存提醒。

### Publish 與後續修改

1. 使用者選擇目標週次，畫面明示會更新該週的 Overview。
2. Publish 使用已成功保存的草稿 revision。編輯器有未保存變更時，需先 Save Draft；不能顯示為已發布。
3. 只有通過伺服端權限、完整資料驗證、重複代碼及版本衝突檢查後，才發布。
4. 成功後 Overview 讀取正式快照；草稿仍保留，繼續編輯不改變正式快照。
5. 例：正式快照 40%，Draft 改為 65% 並儲存，Overview 仍為 40%；再次 Publish 成功後才變 65%。
6. 切換到其他週次不自動發布。發往新週也須明確操作；不能反向覆寫較早週次。
7. 舊週已有的正式快照保持不變。新週照既有 Active carryover 複製正式資料，不複製草稿。

### 已發布週次

Release Week 仍鎖定該週正式內容。草稿可繼續保存，Publish 到已發布週必須由伺服端拒絕；畫面引導選擇未發布週。沒有未發布週時仍能存 Draft，不能自行建立週、重開週或解除發布鎖。

## 4. 資料模型與一致性

`projectDrafts/{draftId}` 使用伺服端識別碼，不使用可能含斜線的專案 code 當文件路徑。

最少包含：schemaVersion、draftId、project（工作稿內容）、revision、createdAt/createdBy、updatedAt/updatedBy、受保護的編輯成員 email 清單，以及最近發布的週次／草稿 revision／時間／操作者。所有授權與發布中繼資料由伺服端建立，client 不能指定或覆寫。

正式週專案保留既有欄位，另附伺服端管理的 publication metadata，識別它來自哪個 draftId 與 revision。Overview、PDF 不取得 Draft 內容或草稿 ACL。專案 code 第一次 Publish 前可更改；第一次 Publish 後保持固定，避免產生重複正式專案。

Publish 以 Firestore transaction 同時讀取 actor、users 權限、草稿與目標週，檢查最新 revision 後更新正式專案與發布紀錄。不得先改週再標記草稿成功。失敗時兩邊都不變，工作稿可重試。

首次發布時 code 已存在且不是同一 draftId，拒絕而不覆寫。重新發布時須匹配 draftId 及目標正式版本；跨週 carryover 後可識別同一專案。既有 legacy 專案不因 code 相同而被自動接管。

Save Draft 使用 expectedRevision 防止兩個分頁互相覆蓋。Publish 同時檢查草稿 revision 與目標正式專案版本，保留既有未知欄位及 server metadata 的相容性。

同一 draft revision 已發布到同一週且正式版本仍一致時，重送為冪等成功，不重複插入或製造發布紀錄；若正式內容已改變則回衝突，不宣稱成功。

## 5. 權限與資料隔離

沿用現有 `userPermissions` / capability resolver 與 Admin 管理方式。本次不新開放所有 PM 新增專案。

| 行為 | 規則 |
|---|---|
| 新建 Draft | Admin；或已有 `project.manage` 的 PM |
| 讀取、保存既有 Draft | Admin；或 server-stored 編輯名單中的 PM |
| 第一次 Publish | Admin；或有 `project.manage` 且屬於該 Draft 的 PM |
| 再次 Publish 既有正式專案 | Admin；或屬於該 Draft 且仍符合正式專案歸屬的 PM |
| 變更編輯成員／歸屬 | 僅 Admin；從 users 目錄驗證角色與 email |
| 管理／發布週次 | 沿用原有權限，Draft 不附帶 week.manage 或 week.release |
| 其他角色／匿名／目錄外帳號 | 不得讀取或修改 Draft |

Admin 可以把草稿指定給 PM。PM 自建草稿的初始負責人由伺服端設為本人，不能以請求中的姓名或 email 自行冒認他人。新的草稿 ACL 使用經 users 目錄確認的 email；公開專案仍保持既有顯示姓名，避免把顯示名稱當作草稿授權依據。

撤銷 `project.manage` 後不能新建或首次發布；仍屬於自己的既有草稿可按現有 PM 編輯權保存。再次發布的邊界對齊既有 owner/deputy 編輯權，不附帶新增／刪除權。移除編輯成員或 PM 角色後，後續讀寫立即拒絕。

以既有 callable 模式提供 list/read/save/publish。每次請求由 server 重新讀取角色、授權、草稿 ACL；不信任 client role、作者、publication metadata 或 UI 狀態。列表只回授權草稿，不能先回全部再在瀏覽器過濾。

Firestore Rules 明確拒絕 client 直接讀寫 `projectDrafts` 與發布稽核紀錄；草稿透過伺服端授權入口存取。原始週的 client write 仍拒絕。既有 Production Rules 不放寬。

對新流程管理的正式專案，舊 Save、attention 快捷修改及週報貼入等寫入入口不能繞過 Draft → Publish 直接改正式內容；應安全轉入工作稿或明確拒絕並引導 My Drafts，不能假裝儲存成功。其他 legacy 專案沿用原來入口。刪除／封存保留既有明確管理權，不由 Publish 暗中執行。

## 6. Overview 與出口

`weeks.projects` 只接收正式快照，Draft 永遠不合併到 allWeeks 或供 Overview 計算的集合。

Draft 不得影響：專案數、進度百分比的分子／分母、RAG／風險統計、資源與預算彙總、跨週趨勢、Overview／單案正式 PDF、Copilot 正式週資料、建立下一週、Production → UAT 週同步。

沒有正式專案時沿用既有空狀態，不以草稿補位。若未來需要 Draft Preview PDF，另行設計，本次不提供正式匯出草稿的旁路。

週同步只同步原有正式週內容，不新增草稿同步、複製或清除功能。同步／還原後舊版 target fingerprint 不一致時 Publish 必須衝突，不能因同代碼而接管。

## 7. UAT 與 Production 邊界

本次以 UAT 功能實作、UAT build、本機 emulator、測試及未部署的 Draft PR 為交付範圍。

新 UI 只在 UAT 啟用；伺服端以明確 UAT project identity 檢查啟用條件，不能以 client profile 參數啟用。Production build 沿用原行為，新 draft callable 在非 UAT 環境拒絕操作；不得變更 Production 資料、權限或資源。

不直接 merge、deploy、建立雲端 runtime identity 或授予 IAM。若新 callable 需要 dedicated service account 與最小權限，先在 PR 列出具體配置與 UAT 部署前置條件。沒有 live 部署就不宣稱 UAT 驗收完成。

Production 正式導入另需核准與環境驗證。Archive 與既有資料不遷移、不重建。

## 8. 錯誤與使用者回饋

Save 或 Publish 失敗時保留編輯內容並顯示原因。版本衝突要求重新載入比對；權限拒絕不能自動重試到另一入口。逾時後可明確讀回發布紀錄確認，不以 optimistic UI 宣稱發布成功。

帳號切換、登出、角色失效時清除草稿列表及編輯 session；舊請求不得把另一帳號的內容帶回畫面。不把草稿保存到持久瀏覽器快取。

## 9. 驗收條件

1. 新案 Save Draft 後重載／換週／重新登入仍可找到；正式週資料完全未變。
2. Draft 100% 與高風險資料不改變任何 Overview 計數、進度、分母、風險與趨勢。
3. 有權 PM 可保存自己草稿；另一 PM、非 PM、匿名、目錄外帳號均不能讀取或操作，直接猜 ID 亦拒絕。
4. 直接 Firestore get/list/query/write Draft 全部拒絕；callable 不能偽造 ACL、角色、作者或發布欄位。
5. Publish 才新增正式快照；第一次未授權／資料不完整／code 衝突／已發布週均拒絕。
6. 已發布 40%、工作稿儲存 65% 時 Overview／PDF／Trend 維持 40%；再次 Publish 後該週才更新為 65%。
7. Publish 不更動既有歷史週；建立新週只複製正式快照，草稿維持獨立。
8. 併發保存、版本衝突、重送發布、timeout、權限撤銷與帳號切換均有拒絕或一致性驗證。
9. 舊 Save、attention、週報貼入及其他寫入入口不能直接修改新流程的正式專案。
10. Legacy 專案、Archive、Manage Weeks、Release Week、PDF、週同步回歸通過。
11. UAT／Production build 綁定正確；Production 不啟用新功能，非 UAT server 呼叫拒絕。
12. 提供測試結果、Draft PR、限制與未部署狀態；獨立安全審查通過前不宣稱可上線。

## 10. 驗證與後續

實作計畫需涵蓋：純資料與狀態測試、callable transaction／權限測試、Firestore Rules emulator、統計與 PDF 隔離回歸、UI 保存／發布 smoke test、UAT／Production build 及 diff 檢查。使用合成資料，不以真實 Production 新增／發布專案測試。

本文件目前只有設計，沒有實作或功能測試結果。使用者審閱確認後，下一步撰寫具體實作計畫並選定執行方式。建議由目前 Codex 接續，先單代理實作，再安排符合安全風險的獨立審查。
