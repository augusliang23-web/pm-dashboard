> Superseded product policy (2026-10-25): Google is UAT-only and Admin-only. PM/all other roles use password; Production must not receive SSO. This document is historical; follow ../sso-uat-admin-only/REPORT.md and RELEASE_ISOLATION.md.

# Antigravity 獨立 QA 交接

範圍：審查此本機提交與 PR79 的差異，驗證 UID/provider 防護、Admin 原 UID／角色、PM 隔離、取消及撤權清除，並重測 S01 草稿／發佈。不得操作雲端或真實帳號。Gate與後續雲端授權回報 ChatGPT Control Plane。

## 環境與執行

Node22、Java21、Docker；root/functions/pdf-service 各自 npm ci。密碼由本機測試執行時隨機產生，不放進文件。使用 demo-pm-dashboard-v22t 與 localhost，禁止換成真實 project ID。測試會重建專屬模擬器資料。

```sh
npm run test:all
npm run test:rules
npm run verify:sync-boundary
npm run build:hosting:prod
npm run build:hosting:uat
(cd pdf-service && npm test)
npx firebase emulators:exec --project demo-pm-dashboard-v22t --config firebase.rules-test.json --only firestore 'node --test --test-concurrency=1 scripts/verification/sso-security-gate.mjs'
SPRINT_TEST_PASSWORD="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")" npx firebase emulators:exec --project demo-pm-dashboard-v22t --config firebase.v231-e2e.json --only auth,firestore,functions 'node scripts/verification/sso-dual-account-browser.mjs'
```

S01：相同 demo模擬器配置，執行 scripts/verification/ux-sprint-01-browser.mjs --functional 與 scripts/verification/admin-self-hotfix-e2e.mjs --functional（各自獨立執行／seed）。請先確保專用 ports 未被其他工作佔用，不停止不屬於本次的服務。

## 合成身分

sso.admin@example.test / sso-admin 為 Admin；sso.pm@example.test / sso-pm 為 PM；sso.unknown@example.test / sso-unknown 沒有 dashboard role。全部只存在 demo模擬器，不提供真實帳號或密碼。

## 必驗情境

1. 同時登入 Admin／PM：刷新與各自登出不互相影響，PM不能看到 Admin 操作。
2. Admin 以密碼重新驗證後連結模擬 Google：UID／角色／密碼 provider 不變，瀏覽器不寫 googleSubject；未核准前 Google 被拒絕，密碼可回復登入。
3. 核准合成 subject 後 Google 登入；Admin 自選 Primary PM、Save Draft、Publish、重開；PM獨立使用自己的草稿。
4. UID不符、缺綁定、未驗證Google、provider不符、account collision、未知角色全部拒絕；PDF必須在週資料讀取前拒絕。
5. 取消仍開啟的 popup、logout、晚到非同步回應不能恢復私人畫面；active=false 或綁定撤銷立即清除本機私人 state。
6. S01 即開 editor、loading、duplicate publish、失敗保留輸入、My Drafts表格與Refresh焦點、Admin-self與真正access-loss分類不退步。
7. 精確來源 delta 負向測試仍能攔截無關 auth 修改；不要直接更新歷史 hash。

## 證據與限制

本機結果及截圖在 evidence/；runtime-sha256.json 可比對提交內實際執行檔。S01舊 harness執行時的 HEAD 是基線，已移除誤導性的 commit 欄位並以實際 bytes manifest說明。三項 root skip 是既有項目，無新增 skip。PDF本機測試host Node22、Docker Node24/Linux；新SHA hosted CI 尚未執行。

雙 Chromium contexts提供儲存空間隔離，但不是人工 Chrome Profiles或真正 Google 授權畫面；後者必須在另行核准的 UAT執行。雲端部署／Auth設定／migration inventory／live rollback readiness本次均未驗證。所有 retained users先補綁定，所有權限入口先更新，再核准啟用Google。完整雲端及復原計畫參見 UAT_CHANGE_AND_RECOVERY_PLAN.md。
