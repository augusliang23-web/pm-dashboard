# V2.3.1 Unified Release — implementation and evidence

本 PR 為 Owner 核准的 A–E 單一發布準備；**部署 HOLD，請勿合併或部署**。

## 已實作

- 正式 Draft／Archive 必須明確啟用；`releaseCapabilities/v231` 綁定同專案與 schema。環境資格、後端支援、前端入口、legacy enforcement 各自判斷；每次寫入 transaction 重新讀取設定。
- 使用既有 `getDashboardProjectDraft({capabilities:true})`，不新增額外 callable 或 runtime identity。設定與 Draft／audit 皆維持 client-denied。
- 逐項提升 Archive modal、My Drafts、兩種儲存及編輯入口；保留既有 Production profile 與 Sync／Executive 寫入隔離。
- Archive 檢查來源 SHA-256 revision，保留歷史、其他目標專案並記錄還原來源／操作者。Draft 拒絕大小寫代碼衝突及歷史週新寫入；已成功發布的唯讀 retry 仍可 idempotent 回覆。
- 正式索引清單只包含兩個 Draft 查詢依賴。`authorizedReleaseOverrides.v231UnifiedProduction` 只允許指定五個 Functions，舊版與通用部署政策仍禁止 Draft；Sync 無例外。

## 驗證

- Root：1768 PASS、0 FAIL；3 個既有 skip（過時 engine、另以真實 emulator 執行的 Rules entry、過時 UAT-only deployment-doc assertion）。沒有新增 skip 或略過安全驗證。
- Rules：Production 16／16、UAT 17／17、shared 17／17；含 Admin／PM／VIP 對 Draft、publication audit、activation 直接讀寫拒絕。
- PDF 全套：修正前 550／550；修正後受影響完整 renderer／integration 檔 40／40。PR CI 須再次執行最終完整套件。
- 真實隔離：Firebase Auth／Functions／Firestore emulators，Production Rules 與 Production-profile Chromium；涵蓋 Admin create、PM save/reopen（含登出登入）、publish/republish、revision／ownership／assignment 拒絕、Admin archive、restore、duplicate／released／historical 拒絕、audit、歷史保存、真實並行還原、restore-only PM、legacy editor、6／12 Overview 及跨專案拒絕。沒有 mock callable 或正式 fixture 寫入。
- 真實 PDF：使用 emulator token、真實 Firestore history、Production feature policy、HTTP handler 與 Chromium。6／12 PDF 均實際產生；Poppler 檢查中文字與嵌入字型並逐頁視覺檢查。這是本機 macOS 字型證據，不是 staged Cloud Run image 的字型驗證。
- Sync boundary、packaged metrics check、兩種 Hosting build、Production Hosting dry run 通過；dry run 未執行 Firebase deployment。

## 實際發現與發布阻擋

12週 PDF 原 renderer 讀取不存在的頂層 `contract.windowWeeks`，而真實 engine 使用 `contract.provenance.windowWeeks`，造成成功下載的「12週」PDF 仍只有6週圖表。原單元 fixture 人工放入頂層欄位，因此未抓到問題。本 PR 以真正 engine contract 的 RED→GREEN 回歸及兩行 renderer 修正處理。

本機修正與驗證不會改變既有 staged image digest。原發布計畫指定重用 `pm-dashboard-pdf-00039-kiw`，digest `sha256:01b014b232eb527f554e8d35f47f3fa3132e0b377d0c46946b18900cd9c71f99`；目前沒有證據證明該 artifact 包含本次新修正。未下載其映像或宣稱 staged/live 的 authenticated 12週輸出已通過。

**需 Control Plane 決定是否改用包含修正的新 PDF 候選（一次必要 build、零 normal traffic、記錄新 revision／digest 及回復目標），再恢復整體發布。** 沒有進行 Cloud Build、IAM、index provisioning、merge、Hosting／Rules／Functions deploy 或流量切換。

## 審查與接續部署順序

一次獨立 GPT-6.1 Sol／High 審查未發現 Critical／High source finding；58 backend＋17 frontend/controller tests 由 reviewer 獨立通過。兩項 Medium deployment findings（缺正式索引、舊政策禁止 Draft）已補上精準來源設定／例外；live readiness 仍待後續驗證。PDF 兩行修正是在該審查後由真實渲染發現並以針對性回歸驗證，不能宣稱 reviewer 已審過此新增 diff。

解除候選方案衝突後：完成必要 review／CI與確切 main SHA → 專用 SA／最小 custom role/binding（不得新增 actAs）→ 兩個索引 READY → 舊版回復 targets/permissions verified → inactive backend → 舊前端相容性 → 已驗證 PDF candidate → exact-merged-SHA Hosting → 同專案 activation → 唯讀正式 smoke。若 live attention handler 存在，也須納入同樣 enforcement；不得為不存在的 handler 建立不必要 identity。

Owner 已移除備份 Gate，禁止新增 PITR、備份／匯出與隔離雲端 restore DB。Application rollback 不會回復使用者的 Firestore 寫入。正式 restore／publish 寫入驗收仍需 Owner 後續確認。


## Owner-approved Attention IAM Option A remediation

Owner已核准專用pmdash-project-attn SA／pmdashAttentionRuntime role／單一binding；不沿用Compute Editor、不改動既有Compute bindings。Attention只有known-document transaction reads及exists:true update，因此角色精確三項datastore.databases.get、datastore.entities.get、datastore.entities.update，無list/create/delete或服務／憑證管理權限。依官方Native Firestore IAM API表與實際SDK核對；獨立reviewer已限定複核。Draft role仍為已核實的五項Firestore權限。

Release override現精確六個Functions，新增setDashboardProjectAttention使用pmdash-project-attn；source本來已指定此SA，沒有把任何handler切換到Compute或其他共享身分。新增真實attention啟用前callable相容、unauth/wrongowner/released拒絕、啟用後legacy拒絕與refresh提示、瀏覽器dropdown→editor→Save Draft保留官方值→Save & Publish更新官方值。最終新SHA仍須CI與必要GitHub review。

原兩項設計HOLD已由Owner解除，允許exact merged SHA的一次必要新PDF candidate（existing service/region/infrastructure、明確--no-traffic/new tag、old Production100% readback）。不得用舊00039作修正版，也不得直接呼叫會切換流量的舊deploy script。Artifact、IAM readback、rollback與正式smoke證據以本機最終報告為準，不以來源說明宣告部署成功。
