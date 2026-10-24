# SSO Google V1 本機實作交付

A. VERIFIED_BASE_SHA：PR79 `30b19c7d82118d19595006192e16401a7c9d1d49`；交付前遠端仍 OPEN/Draft，main `b3b7a51d5db680cfc87acdf24d06d73a9de2aaac`。隔離工作樹、單一執行者，未更動既有分支。

B. SECURITY_ARCHITECTURE：先完成權限阻擋與模擬器驗證，再加入 Google UI。三個 Rules profile、五個 actor loader 所涵蓋的24個 authenticated callable，以及 PDF 資料讀取均檢查可信任 users 記錄。瀏覽器不能建立角色／身分綁定。排程 presence 聚合未修改。

C. UID_BINDING_DESIGN：所有登入方式必須匹配 authUid；Google 另外要求已驗證 email、googleSubject 與實際 provider subject 一致。角色只取伺服器記錄；未知角色、不同 UID、未核准 provider 均拒絕。瀏覽器清除撤權／登出時的私人資料，沿用 S01 非同步世代保護。三份 identity helper 位元一致且有測試。

D. LEGACY_MIGRATION_STRATEGY：既有帳號先經 Owner 核對完整 Auth UID 清單並補上 authUid，才可啟用嚴格防護；不設 email-only 過渡後門。純本機 planner 只產生經明確核准的新增欄位計畫，不寫入資料。Admin 重新驗證密碼後連結原 UID；Google subject 需 Owner 另行核准，之前仍用密碼登入。詳見 UAT_CHANGE_AND_RECOVERY_PLAN.md。

E. IMPLEMENTED_FILES：index.html、js/google-auth-flow.mjs、三份 dashboard-identity.js、三份 Rules、五份 Functions actor loader、PDF report-data.js；另有 migration planner、測試及證據。未新增套件／framework，lockfile 不變。S01 controller/workspace 與 Admin-self core 未修改。未納入 PR77。

F. COMMIT_SHA：本文件包含於本機提交；請以外部交付報告的 exact SHA 或 git rev-parse HEAD 核對，避免提交自我參照。runtime-sha256.json 綁定本次測試的實際執行檔案。

G. LOCAL_TEST_RESULTS：root 1936 PASS /0 FAIL /3原有 skip（1939 total）；PDF 551/551；Rules 16+17+17=50/50；安全 gate 6/6 groups，29條檢查記錄，含24個實際 callable handler；真實 Auth/Firestore/Functions 模擬器＋Chromium 雙隔離 context 12/12；S01 browser28/28、Admin-self11/11，pageErrors均為空。Production/UAT Hosting各41檔案建置通過；sync boundary、Delivery Trends parity及本機 PDF Docker build/smoke通過。新 SSO 提交未執行 hosted CI。既有 PR79 hosted CI 5/5 是基線證據，不能替代新提交 CI。

凍結來源防護：歷史預期 hash 不變；新增9個唯一精確區塊的可逆 delta，還原到固定 PR79 HTML SHA256 dce6db70bb4e03fd3ecad98c2aa927a0f4ef3009bf307abcccccff0aeeef05a4。缺失、重複、修改與無關 auth 變動的負向控制皆通過，沒有略過安全測試。

H. REMAINING_SECURITY_RISKS：尚無正式 Google chooser／人工 Chrome Profiles／實際既有帳號移轉證據。模擬器不證明雲端設定正確；實際帳號與費用模式未知。撤銷 refresh token 或停用 provider 不等同已發出 ID token 立即失效；每次請求的 active／UID／subject 綁定才是本次實作的拒絕界線。連結 Google 可能觸發 token 更新並在核准前登出，UI 明確指引密碼登入。所有保留帳號完成移轉是未來啟用的必要條件。

I. REQUIRED_UAT_CLOUD_CHANGES：另行核准 Auth provider／domains、完整帳號綁定、獨立 PM provisioning、UAT Rules／24個 callable／PDF／Hosting 的協同更新。Google 必須保持停用直到所有資料入口防護就緒。任何 service identity／IAM／API 要求另行停止回報。本次未執行任何雲端變更。

J. ROLLBACK_PLAN：保留 Admin UID、角色、專案持有人及新增綁定。優先維持 UID 防護並只退回 Google UI；不得直接退回 email-only backend，也不可假設只退 Hosting 安全。未來部署前須捕捉實際 revisions／Rules／Hosting及復原 Admin；本次未查驗雲端 rollback inventory，不承諾復原時間。

K. ANTI_INDEPENDENT_QA_HANDOFF：詳見 QA_HANDOFF.md。獨立 QA 尚待執行；沒有自批產品／上線 Gate。

L. GO_HOLD：SSO_GOOGLE_V1_LOCAL_READY（本機實作與測試完成）；UAT／正式啟用仍 HOLD，等待獨立 QA、完整移轉證據及另行雲端授權。沒有 push、PR、merge、deploy、live Auth/linking／資料寫入／IAM 操作。
