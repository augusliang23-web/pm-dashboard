# P0 所選週發佈目標修正 — Independent QA

基準：Production 8400f54db846f52f2c75b59d789002dc83bc4657；不是 main。產品範圍：index.html、js/project-drafts-ui.mjs、functions/project-drafts.js、functions/project-drafts-core.js。

## 原因及修正契約

原前端 configureDraftEditor 與 saveEditorProjectDraft 會把目標覆寫為 latestPublishWeekId；後端另有全域 latest 限制及 lastPublication 高水位限制。已發布專案跨週共用同一 draftId，因此只改前端或刪除 historical guard 均不足。

現在 Editor 開啟時固定明確所選週，另存 publishWeekId（原草稿 session.weekId 固定為 draft-workspace）；點擊時核對目前週、固定目標及 session。buildDraftPublicationInput 送 selectedWeekId，with-form Publish 缺少或不符即拒絕。這是刻意 fail-closed 的 API 更新：舊前端的原子 Publish 將失敗，而非繼續錯寫最新週。

歷史修正：僅允許已存在且唯一關聯的正式專案、未釋出週、目前 actor 的既有 draft access 和 live ownership，並檢查 draft revision、target fingerprint/marker、visibility。使用所選正式快照顯示／合併表單；要求有週名的確認視窗與 historicalCorrection:true。後端在同一 transaction 僅修改目標週、該週 publicationTargets 與新增 audit；工作草稿 project/assignment/revision/lastPublication/lastSaveAndPublish、其他 target 以及較晚週均保留。Audit 明列 historicalCorrection、requestDigest 和前後 projectRevision 雜湊。每目標 request digest 支援遺失回應後的同請求去重；不自動重試。

歷史 Editor 的 Save Draft 停用，明示使用確認後 Save & Publish，以免覆蓋共用的較晚週工作草稿；PM/Deputy 顯示該歷史快照並唯讀。一般最新週 Save Draft／Publish 不受此模式影響；latestPublishWeekId 保留作新草稿卡片位置用途，不再替 Editor 決定發佈目標。

## 聚焦獨立審查

- 執行 functions/test/week-target-correction.test.cjs 與 tests/week-target-selection.test.mjs；檢查錯誤週、released、未確認、失去 ownership、舊 revision／fingerprint、atomic audit failure、idempotency、最新週後續發布。
- 特別檢查 historicalCorrection 不會提供角色／ownership bypass，不會改寫 working draft 或 later publication lineage。一般無表單歷史發佈仍拒絕，不能透過舊客戶端繞過確認。
- 檢查新 HTML 精確還原 fixture 及負向測試；所有既有 frozen hash 不變。
- Node 22、Java 21、root/functions lockfile 依賴；瀏覽器測試需要 pdf-service Puppeteer。不要使用 deploy script。
- demo 模擬：GCLOUD_PROJECT=demo-pm-dashboard-v22t、FIRESTORE_EMULATOR_HOST=127.0.0.1:8188、FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9198、SPRINT_TEST_PASSWORD 自選本機合成值。執行 `firebase emulators:exec --config firebase.prod-s02-emulator.json --only auth,firestore,functions --project demo-pm-dashboard-v22t 'node scripts/verification/week-target-browser.mjs'`。會清空指定本機 emulator 的合成紀錄；先確認測試埠未被其他工作使用。
- 瀏覽器情境：W43 25%，建立／發布 W44 25%，切回 W43，進度20%，先取消確認（不寫）、再確認（只改 W43）；確認 W44整份資料 byte-equivalent，shared draft 的 working content/revision/assignment/high-water lineage 不變。最後兩個同版本修正並行只有一個成功，另一個 conflict，再以已知新 fingerprint 合成修正回20。
- 輸出 tmp/week-target/evidence：390px target screenshot、results JSON。這些是合成 local evidence，不能宣稱 Production 使用者接受。

## 提議部署與停止條件

僅 Production Hosting（41個資產中 index.html 與 js/project-drafts-ui.mjs 變更）以及 functions:publishDashboardProjectDraft。save/get/list 的行為未修改，無需部署；雖共用來源 package，僅指定 Publish target。Auth/Rules/IAM/PDF/activation/Guard/manifest 不變。

目前無部署授權。新 exact SHA 需要適用 CI、Antigravity QA、受授權 UAT 驗證／Control Plane Gate、一次性 Production release policy 例外與 Owner 部署授權。先更新並驗證 backend，才發布新 Hosting；舊 frontend 在此過渡期 with-form Publish 會明確拒絕。不得回退到會重導最新週的前端，也不得盲目回退到拒絕 Admin-Deputy 的 backend。
