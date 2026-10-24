# 本機 QA 重現與整合界線

基線PR79 30b19c7d82118d19595006192e16401a7c9d1d49；分支codex/s01-deputy-card-ui-fix。交付SHA見外部報告或git rev-parse HEAD。無新PR/Hosted CI/部署。本次無平行代理。

Node22、Java21；root/functions/pdf-service dependencies用各自npm ci。使用firebase.v231-e2e.json專屬localhost ports及demo-pm-dashboard-v22t，不可替換真實project；測試會重建合成模擬器資料。執行時隨機產生SPRINT_TEST_PASSWORD，不在報告記錄密碼/token。

```sh
node --test tests/*source-baseline.test.mjs tests/project-assignment-eligibility.test.mjs tests/dashboard-profile-invariants.test.mjs tests/auth*test.mjs tests/*draft*test.mjs tests/ux-sprint*test.mjs tests/drafts-refresh-focus.test.mjs tests/tbd-assignment.test.mjs functions/test/*draft*.test.cjs functions/test/admin-self-assignment.test.cjs functions/test/deputy-self-assignment.test.cjs
npm run build:hosting:prod
npm run build:hosting:uat
SPRINT_TEST_PASSWORD="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")" npx firebase emulators:exec --project demo-pm-dashboard-v22t --config firebase.v231-e2e.json --only auth,firestore,functions 'node scripts/verification/deputy-card-ui-browser.mjs && node scripts/verification/admin-self-hotfix-e2e.mjs --functional && node scripts/verification/ux-sprint-01-browser.mjs --functional'
```

baseline模式僅重現UI，需要旁邊的../pm-s01-final-integration精確PR79工作樹；不修改它，僅從它建置到本次tmp。Functions使用本次模擬器；修正前後端拒絕證據另有backend-red.log，不能把baseline UI宣稱為舊backend部署。截圖Deputy選單以測試中暫時size=8展開，保留實際選項；產品仍是原生下拉選單。card截圖來自390/320px viewport內的實際卡片元件，不是設計稿。before結果的FAIL是預期重現證據；after必須全PASS。

必驗：Admin自己/有效PM/Unassigned可選且無重複；其他Admin、非PM、disabled=true/active=false排除。原Deputy讀取與開啟不寫回；save/publish/reopen保留新值，PM不能更改指派或繼承Admin角色。看不到的現有指派以disabled current assignment保留，不自動刪除。既有S01快開、取消、衝突/失敗保留輸入、重複點擊、防舊請求、慢list刷新不阻擋關閉、Draft表格與Refresh焦點回歸。

卡片用green/yellow/red既有有效狀態（現行文案On Track/At Risk/Critical），沒有改名或新增Delayed狀態；測試1440/1024/768/390/320px，每張卡status不重疊、按鈕命中範圍可點、文字不超出卡片。More保留原有Visibility/Archive/Delete與確認/授權流程。

未查live Auth disabled狀態；本次停用判斷只依可信任users目錄active/disabled欄位。Auth-only停用若沒有同步到目錄，不可宣稱已做跨服務停用盤點。未做真實UAT驗收或新SHA hosted CI；無重跑PDF/SSO全套。

PR79/PR80都保持原SHA。此修正要先由Control Plane決定整合路徑；若進入PR79基底，PR80就必須吸收更新並驗證新整合SHA。衝突重點是index imports／兩個目錄載入點／beginDraftEditor與精確來源guard。functions/project-drafts-core.js需保留SSO外層UID/provider guard，再套用本次內層assignment eligibility；新helper須在Functions與Hosting封裝內。不得只使用本次PR79-base commit取代PR80、不得覆蓋SSO，不能把舊CI/QA PASS沿用為新整合SHA的證據。重跑5項CI及受影響的SSO/指派安全流程；無需擅自retarget或重寫既有分支。
