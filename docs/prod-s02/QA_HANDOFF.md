# Production S02 本機候選 — Antigravity 聚焦 QA

範圍：5 個產品檔案及相關測試差異。從 Production 05019ea 開始；不重新進行完整 SSO/Guard 研究。commit/tree 與 Hosting manifest 由外部 pending approval record 提供。

必查：Admin self owner/Deputy；其他 Admin、disabled/inactive、unknown、normalized duplicate、embedded identity mismatch 的拒絕；普通 PM 不可透過 assignment 提升權限；沒有 explicit assignment 的既有草稿不掃整個目錄、不改指派；Save/Publish/revision/idempotency；Production readActor 與 server permissions 保持原樣。錯誤 UID 綁定遷移不屬本次；現有 Protection 不可倒退。

UI：320、390、1440 px 卡片 Edit/status 不重疊、Deputy 在容器內、Published Project Actions 與 Save/Publish 同一區；Admin-only Visibility，project.manage delete，確認視窗、Esc 和焦點；Save Draft pending 不顯示成功、只有一個 request、成功後 Publish 正常關閉。macOS 原生選單彈出範圍仍需 Owner 手動接受；自動化只證明 select DOM 幾何。

本機重現（先用 lockfile 安裝 root/functions 依賴，瀏覽器驗證另需 pdf-service 的 Puppeteer 和已安裝瀏覽器）：Node 22、Java 21。執行 `npm run test:all`、兩個 `build:hosting:*`、`npm run verify:sync-boundary`、`node scripts/package-delivery-trends.mjs --check`。不要使用任何 deploy script。

合成 emulator：設定 GCLOUD_PROJECT=demo-pm-dashboard-v22t、FIRESTORE_EMULATOR_HOST=127.0.0.1:8188、FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9198，SPRINT_TEST_PASSWORD 為任意本機合成密碼。使用 `firebase emulators:exec --config firebase.prod-s02-emulator.json --only auth,firestore,functions --project demo-pm-dashboard-v22t 'node scripts/verification/prod-s02-flow.mjs && node scripts/verification/prod-s02-layout.mjs'`。此程式會清空**指定本機 emulator**的合成資料，先確認埠未被其他工作使用；程式檢查 demo 專案與固定本機連線。不要連到真實專案。

產物：tmp/s02a-ui/after 內 card/editor 320/390/1440、published-actions screenshots、geometry/results JSON；tmp/s02b-browser/site 為本機 Production 設定建置。這些不進 commit，不冒充 live UAT 或 Production QA。

PASS 條件：上述安全規則及流程無阻擋缺陷，歷史 hash/負向測試仍有效；另列 Owner 原生 UI 接受與部署 Gate，QA PASS 不授權發佈。
