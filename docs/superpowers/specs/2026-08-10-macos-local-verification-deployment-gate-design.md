# macOS Local Verification and Deployment Gate Design

## Status

Approved design for implementation.

## Goal

建立一套以 macOS 為唯一開發環境的本機驗證流程，讓 v2.2T 與 v2.1 在部署前都能先使用本機 Firebase Emulator、測試帳號、完整測試與 smoke test 驗證；v2.1 只有在明確指定同步時才納入同一次修改與部署。

## Scope

### In scope

- 為 `pm-dashboard-uat`（v2.2T）建立 macOS 本機啟動、seed、驗證與部署閘門。
- 為 `pm-dashboard`（v2.1）建立對應的 macOS 本機 Emulator 與驗證流程。
- 確保本機 Auth、Firestore、Functions 使用同一組 Emulator，不再混用正式 Auth 與本機 Firestore。
- 建立本機測試帳號與最小可運作的角色／週資料。
- 將完整 Node 測試、本機服務健康檢查、smoke test 與 diff 檢查串成部署前驗證。
- 保留明確分開的 v2.2T 與 v2.1 發布入口。
- 驗證部署後網站仍可由 Windows 使用者透過標準瀏覽器使用。

### Out of scope

- 不建立或維護 Windows 開發／Emulator 啟動流程。
- 不自動把 v2.2T 的程式碼複製到 v2.1。
- 不使用正式帳號登入本機 Emulator。
- 不讓本機 seed 或 snapshot 流程寫入正式 Firebase。
- 不改變目前 PM textarea 的產品輸入規則；該規則仍以原生 textarea 行為為準。

## Version and synchronization policy

| Repository | Version | Default action | Deployment target |
|---|---|---|---|
| `pm-dashboard-uat` | v2.2T | Implement, test, and deploy by default | v2.2T GitHub Pages |
| `pm-dashboard` | v2.1 | Do not modify unless explicitly requested | v2.1 production GitHub Pages |

每一次修改都必須標示為以下其中一種：

- v2.2T-only：只在 `pm-dashboard-uat` 實作、驗證與部署。
- sync-to-v2.1：先在 v2.2T 驗證，再將適用的變更明確套用到 `pm-dashboard`，在 v2.1 重新驗證後才部署兩個版本。

流程不得以相似檔案自動猜測同步範圍，也不得因為兩個 repo 有同名檔案就自動覆蓋。

## Architecture

### Local application mode

兩個版本在本機都以查詢參數明確啟用 Emulator mode：

```text
http://127.0.0.1:4173/?emulator=1
```

啟用後，前端必須同時連接：

- Firebase Auth Emulator：`127.0.0.1:9099`
- Firestore Emulator：`127.0.0.1:8080`
- Functions Emulator：`127.0.0.1:5001`

未啟用 Emulator mode 的本機網址不得將正式 Auth 與本機 Firestore 混在一起。正式帳號只用於線上部署網址。

### macOS local runner

每個 repo 提供相同概念的 Node runner，由 macOS Terminal 執行。Runner 負責：

1. 檢查 Node.js、Java Runtime、Firebase CLI、Functions dependencies 與必要埠號。
2. 啟動 Auth、Firestore、Functions Emulator。
3. 等待三個服務健康後，執行該版本的本機 seed。
4. 啟動本機靜態預覽服務。
5. 輸出版本、測試帳號、本機網址與停止方式。
6. 收到終止訊號時，同時停止子程序，避免留下殘留服務。

既有 PowerShell／CMD 腳本保留作為歷史參考，但不再是 macOS 流程的依賴。

### Local data safety

預設 seed 只建立標示為 local-only 的測試帳號、角色與最小測試資料。若要載入 production snapshot，必須使用獨立的明確命令；該命令只允許輸出到 `127.0.0.1:8080`，並在目的地不是 Firestore Emulator 時直接失敗。

測試帳號的密碼與文件標示為 test-only，不得使用真實公司帳號或正式密碼。

## Command contract

兩個 repo 都提供相同語意的命令；命令名稱可以依 repo 的版本前綴顯示，但行為必須一致：

```text
npm run local:start       啟動本機 Emulator、seed 與 localhost 預覽
npm run local:stop        停止本機 runner 管理的服務
npm run local:seed        重新建立本機測試帳號與資料
npm run test:all          執行該 repo 的完整測試集合
npm run test:local        檢查 Emulator、測試帳號、角色文件與本機登入路徑
npm run verify:local      執行 test:all、test:local、diff check 與部署前檢查
npm run deploy            先執行 verify:local，通過後才允許發布目前 repo
```

`npm run deploy` 不自動選擇另一個 repo，也不自動同步 v2.1。v2.1 的部署必須在 `pm-dashboard` repo 中另外執行，並且只有在本次工作明確標記 `sync-to-v2.1` 時才使用。

## Verification design

### Source tests

`test:all` 必須執行目前 repo 已有的 Node test suites，並包含與版本入口、Firebase 初始化、textarea 輸入行為、角色權限和部署 wiring 相關的測試。

### Local stack smoke test

`test:local` 必須確認：

- Auth、Firestore、Functions 三個 Emulator 可連線。
- 預期的 local-only 測試帳號存在。
- 測試帳號的 `users/{email}` 文件存在且角色可解析。
- 前端本機入口包含 Emulator mode 並指向本機服務。
- 登入後可以完成最小 dashboard access initialization。
- 失敗時顯示實際分層錯誤：服務未啟動、帳號不存在、角色文件不存在、Firestore permission denied 或 Functions 連線失敗。

### Release gate

`verify:local` 必須在部署前重新執行，不接受上一輪測試結果。部署前檢查至少包含：

- 完整測試 exit code 為 0。
- local smoke test exit code 為 0。
- `git diff --check` 通過。
- 目前 repo 與目標 branch／remote 一致，沒有未確認的檔案被納入發布。
- 目標版本與發布命令一致。

任何一項失敗都不得進入 deploy step。

## Deployment behavior

部署仍以各 repo 既有 GitHub Pages 發布設定為準。驗證閘門只負責阻止未驗證的發布，不改變正式 Firebase 資料與權限設定。

部署完成後，必須重新檢查：

- GitHub Pages build 狀態。
- 部署頁面的版本標記與 base commit。
- 線上登入頁可以載入。
- Windows 使用者可用標準 Chrome／Edge 開啟並操作原生 textarea。

線上驗證使用正式部署網址與正式帳號；本機測試帳號不得出現在正式環境。

## Error handling

前端錯誤訊息不得把所有初始化失敗都包成同一個「請檢查權限」訊息。至少要將以下情況分開記錄並在本機測試輸出可辨識的原因：

- `emulator-unavailable`
- `auth-user-not-found`
- `dashboard-role-missing`
- `firestore-permission-denied`
- `functions-unavailable`

使用者畫面可維持簡短訊息，但 Console／smoke test 必須保留實際錯誤類型，方便區分瀏覽器權限、服務未啟動與 Firebase 資料問題。

## Acceptance criteria

- 在 macOS 上可以用一個本機啟動命令啟動指定版本的完整本機 stack。
- 使用 local-only 測試帳號可以在本機完成登入與 dashboard access initialization。
- v2.2T 與 v2.1 都有可重複執行的本機驗證命令。
- `verify:local` 失敗時不會進入部署。
- v2.2T 預設可以單獨測試與部署。
- v2.1 不會因 v2.2T 修改而自動變更。
- 明確指定同步時，兩個 repo 都完成各自的本機測試後才部署。
- 已部署頁面可由 Windows 使用者透過標準瀏覽器使用。
- 不再出現「正式 Auth 登入成功，但本機 Firestore 找不到角色」的混合環境錯誤。
