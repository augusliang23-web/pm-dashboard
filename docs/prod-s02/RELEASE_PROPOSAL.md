# S02_PROD_HOTFIX — 待核准的單次 Production 例外

Owner approval status: **PENDING**。這是本機候選與政策提案，不授權部署。

來源自 `05019ea184d82afbd3fa9404ae06ed1a4e2d3f74`，tree `ea6d8320492b07b09e4ecfddd952301ad839b015`。僅移植已接受 `8633fd02041aa1219aa77429082daf9f55d82847` 的 S02-A/B 精確產品差異；沒有整份複製 UAT main。新候選 SHA/tree 於 commit 後記錄在 repository 外的 `S02_PROD_HOTFIX.pending.json`，避免 commit 包含自己的 SHA。

## 實際政策差異

`config/deployment-manifest.json` 的 `authorizedReleaseOverrides.v231UnifiedProduction` 是舊 v231 專用的宣告，列出 Draft Functions，但不在 `releases` 命名集合中；`scripts/deployment-manifest.mjs` 的 `releaseFor` 只查詢 `manifest.releases[id]`，一般 allowlist/never-deploy 驗證也不消費這個 override。故以該名稱呼叫一般 release validator 會拒絕；不是找不到另一份可自動授權的同名 release。

此外舊例外明確要求 `exact-final-merged-main-sha`，不符合本次隔離候選。不得修改此字串的意義、擴大通用 allowlist、停用或繞過 V2 Guard。現有 UAT 手動操作草案也不授權 Production。

提議 Control Plane 與 Owner 針對本次候選另行核准外部單次操作紀錄 `S02_PROD_HOTFIX`，明訂其為舊 main-only 來源政策的個別例外，並指定 Owner 控制的手動執行途徑。這份提案不會被既有 Guard 自動認可，且不是供 Guard 使用的已簽章合約；必須先完成獨立審查、正式政策及部署授權。此任務不新增框架、簽章機制、帳號或基礎設施。

## 唯一提議範圍

專案 `project-manager-dashboar-a067f`：Production Hosting，以及 `functions:saveDashboardProjectDraft`、`functions:publishDashboardProjectDraft`。所有其他 Functions、排程、Rules/indexes、IAM/Auth、PDF 及 UAT Sync 排除。Firebase CLI 的服務範圍不代表它保證沒有附帶 IAM/API 操作；遇到任何未授權資源變更必須停止。

Hosting 41 個應用資產，相對已核准的 40 個 Production 資產，只有修改 `index.html`、新增 `js/project-assignment-eligibility.js`。`js/project-drafts-api.mjs`、`js/draft-save-progress.mjs`、PDF/config、所有其他資產雜湊不變。完整 manifest 在 commit 外與候選 identity 一起封存；本機 artifacts 不當成 GitHub 或 live QA 證據。

## Production 的設定契約

上次唯讀基準（2026-10-30）：Hosting release `1793241093705000`／version `f9d50f2701fc06bf`；save `savedashboardprojectdraft-00003-zor`／publish `publishdashboardprojectdraft-00002-zof` 各 100% 流量。來源 ZIP 21/21 檔案與基準一致；兩者 ZIP SHA256 `8086565c115ba3815334ef48ad5ca75117c09c8007dcd01f73e068e11678d1e6`。部署時須重新查核，不當作永久事實。

| 設定 | 部署前已觀察 | 候選要求／部署後核對 |
|---|---|---|
| project/region/generation/runtime | Production / us-central1 / GEN_2 / nodejs22 | 完全相同 |
| runtime SA | pmdash-project-drafts@project-manager-dashboar-a067f.iam.gserviceaccount.com | 完全相同 |
| memory/CPU/timeout/max/concurrency | 256Mi / 1 / 60s / 20 / 80 | 完全相同 |
| minimum / VPC / secrets | 此次尚無足夠有效設定快照 | 部署前補齊；minInstances 有效值須為 0，不得增加 VPC/secrets |
| ingress / invoker | ALLOW_ALL；service IAM 有 allUsers roles/run.invoker；未見 UAT 的 invoker-iam-disabled=true | 保留 Production 合約，不複製 UAT 設定；部署前後驗證有效權限 |
| env / activation / Rules | 未變更原始碼；雲端有效值未完整盤點 | 部署前後只記錄安全中繼資料／雜湊，不輸出秘密；不更改 releaseCapabilities 或 Rules |
| callable runtime options | 原有 serviceAccount 與 maxInstances 20 | 程式碼逐字保留；不宣稱未指定欄位必然由 CLI 保留 |

保持 Production 既有 authenticated UID/email + server role/permission 解析；沒有加入 UAT 的 authUid/provider enforcement，也不聲稱兩環境同等保護。所有原有身分、revision、交易及 session 檢查保留。PERF-02A 儲存流程與兩個模組不變。

## 相容性及恢復限制

先部署及確認兩個 backend，再考慮 Hosting；具體順序及操作仍需另外核准。兩個功能可能部分成功，必須逐一記錄實際 Ready revision 與 traffic；任何失敗停止，不自動重試、部署 Hosting 或回滾。

舊 backend 會拒絕 Admin-self Deputy；新版已儲存此指派後，不能盲目切回舊版，亦不得刪除／重指派使用者資料。舊 Hosting 可能把現有 Deputy 當成變更重新提交，因此也須驗證當前資料與 backend 才能恢復。遇安全／資料相容性疑慮停止編輯並回 Control Plane。優先考慮經驗證的相容修復；不承諾未測過的回復時間。

## 尚待完成的正式 Gate

Antigravity 針對此 exact commit 的獨立 QA；獨立 release-policy delta review；適用候選 CI（目前只有本機 evidence）；精確 Production 候選的受授權 UAT 驗證或 Control Plane 明確記錄既有 UAT 證據的適用性；完整有效 runtime/security 快照及實際上傳套件驗證；Owner-only 憑證執行環境的確認；單次 Production 政策例外及明確部署授權。上述不阻擋本機實作，但阻擋發佈。
