# PM Dashboard V2.3 — Gate 2 整合候選報告

環境驗證：正確 origin `https://github.com/augusliang23-web/pm-dashboard.git`；隔離 worktree `/private/tmp/pm-dashboard-v23-e2e-20261014`，分支 `integration/v23-e2e-candidate`。從指定 foundation `83a56b1f8f93fafcf23eda4b8395cca991556777` 建立，整合前乾淨，未覆蓋其他人的變更。原 local main `4d297213373255b227e492b0e4a2a0551b99e02d` 與 origin/main `4a8e7ee63cdf40c3699c834b5ff18c7427e307b0` 不一致；本工作依指定 foundation 執行，未更新 main 或其他 worktree。

狀態：`V23_GATE2_CONDITIONAL`。本地實作與合成驗證完成；真實 UAT 歷史資料、部署後後端驗證／功能啟用、Cloud Run 延遲與 Claude 獨立 QA 結果仍是後續驗收條件。此狀態不代表獲准部署或上線。

## 整合來源與修正

保留兩個來源的提交歷史；初次匯入無文字衝突，後續 QA 更新有兩處衝突，已解決：

- PR #52：`c8cd5d8b6c65e604421c038f79bf34b81ab6f3fb`。
- PR #53：先匯入指定 UX HEAD `0b07724d5d136efa76b7d765ce155b2cdfa1f78e`；最終查驗發現新增 QA HEAD，經使用者明確核准再匯入 `e06da6ec8f1a92d4b48cd552303c27a3ca8c6382`。
- 匯入後 checkpoint：`52602e3ad8069c8e834ea7bbd1e3773b2e95b07c`。

整合時修正的語意問題：

1. Browser 使用 UAT 既有 subscription 的原始週資料，避免一般 Dashboard 正規化把缺少 lifecycle 的專案補成 active；只有 server-confirmed、無 pending writes 的快照才能計算。明確 anchor document ID 避免排序差異，讀取失敗／身分切換會清除資料及已顯示的趨勢。
2. VIP／Executive 一律限制 released weeks；未知角色無法取得趨勢。引擎統一判斷 scope exit、缺觀測及完成，保留資料品質警告並遮蔽目前不可見的名稱。
3. PDF 全選目前 portfolio 時保留完整歷史範圍，避免遺漏已消失專案的 missing-observation 診斷；部分勾選仍限制指定 identities。
4. 新區塊經 report-data → report-model → renderer 傳遞相同 contract。整合 PDF 的既有 weekly-trend 另排除晚於 ISO anchor 的資料；單獨舊區塊行為維持。
5. Runtime 支援明確 UAT future activation，registry 預設 false，缺設定 false，Production 即使設定 true 仍強制 false。前端 verification constant 維持 false。
6. 實際 PDF 發現長專案名稱兩行截斷，改成完整換行並沿用 measured pagination。print DOM 回歸測試先證明可見高度 28 < 全文高度 70，再驗證修正。

## 驗證與一致性

| 驗證 | 結果 |
|---|---|
| Root（含 Functions） | 1,595 PASS、3 SKIP、0 FAIL |
| Functions 獨立執行 | 229 PASS、0 FAIL（包含於 Root，勿重複加總） |
| Rules emulator：Production／UAT／shared | 14／16／16 PASS；合計 46、0 FAIL |
| Gate 2、page 與角色／Production invariant 重點回歸 | 48 PASS、1 superseded pre-engine SKIP |
| Production／UAT Hosting builds | PASS |
| canonical package parity、Production sync boundary | PASS |
| PDF Docker linux/amd64 build | PASS；未 push image |
| 無網路容器實際 render | PASS；合成 PDF 43,808 bytes |
| 新增整合差異的獨立 read-only review | PASS；讀取失敗殘留畫面問題已修正 |

Root 的三個 SKIP 是舊 pre-2A 引擎案例（由目前引擎的明確回歸取代）、獨立 Rules emulator 入口（已另跑 46 項）與原有部署說明案例；沒有跳過失敗測試。PDF 全套 455 PASS、0 SKIP、0 FAIL（已納入 e06da6e 後重跑）。GitHub CI 以候選 PR 對應 HEAD 的 checks 為準；最終報告及 PR description 記錄實際結果。

QA 更新衝突處理：`overview-report.js` 保留 model.deliveryTrends 作為唯一輸入，同時納入 Claude 的 scope／selected counts 提示；`delivery-trends-page.test.mjs` 保留新增 Phase 2A 回歸並設定 historyComplete:true。沒有重新計算 metrics，也沒有啟用功能。PDF 現在明示實際 export scope 與部分選取通知；Dashboard／PDF 不同 scope 時數值可能合理不同，同 scope 的契約仍完全一致。

Browser／PDF 在相同角色、scope、anchor、window 和資料快照下，完整 `delivery-trends/v1` contract 深度比對一致；模型不重算公式，renderer 只使用引擎結果。6／12 週、短歷史與缺日曆週、真零值、null、負變化、scope exit、historical-only、released-only、future-year、讀取失敗及失效 auth callback 有合成回歸覆蓋。完成／legacy identity／rebaseline 邊界沿用匯入引擎測試，完整 Root 套件再次通過。

| Contract 欄位 | 引擎輸出／Web、PDF 輸入 | 相容／調整 |
|---|---|---|
| `weeklySeries[].gainPp`, `comparableCount` | 原欄名及原型別 | YES；無重新命名 |
| `projects[].currentCompletionPct`, `weeklyChangePp` | number 或 null | YES；缺值呈 N/A |
| `projects[].trend[].progressPct`, `comparable`, `isInAnchorScope` | 原契約值 | YES；scope 由共同引擎判斷 |
| `changes.firstObserved`, `confirmedCompleted`, `missingObservation`, `ambiguousIdentity` | 原契約陣列 | YES；全選時保留 missing diagnostics |
| top-level `delivery-trends/v1` | 原契約、warnings／provenance 保留 | YES；無 Claude-side 欄位調整 |

PDF 核准設計顯示最近 6 週；12 週輸入仍完整通過引擎／模型 parity，PDF 顯示其最後 6 週。這是既有呈現設計，並未把 12 週輸入當成 6 週重新計算。

## 實際 PDF 視覺檢查

使用實際 authenticated handler（合成 adapters）、authorized data loader、model、combined Overview renderer 與 Chromium 產生六份 PDF；不接 Production／UAT provider。用 Poppler rasterize 檢查全部 23 頁，另抽取文字驗證六個長專案及長 Project Manager 名稱尾段全數存在。

| 合成案例 | 頁數 | Weekly Gain | Current Completion |
|---|---:|---:|---:|
| 6 projects | 3 | +2pp | 46.5% |
| 7 projects | 4 | +2pp | 49% |
| 14 projects | 4 | +2pp | 66.5% |
| Missing observations | 4 | -10.6pp | 36.4% |
| Long names／managers | 4 | +2pp | 46.5% |
| 12-week input | 4 | +2pp | 49% |

新區塊放在既有 Portfolio Overview 與 Risk & Mitigation Actions 之間；續頁有標題、表頭及頁尾，無裁切或文字重疊。7 專案／12 週輸入案例因新增範圍說明，footnotes 使用獨立標示的續頁，整份由 3 增為 4 頁；保留可讀性，未縮字或裁切。缺觀測例保留 chart gaps、N/A、真實 0%、負變化及警告；警告較長時另有 continuation 頁。每份新區塊明示 synthetic preview，無 Production 資料聲稱。可重現腳本：`scripts/verification/v23-gate2-samples.mjs`；PDF／Browser HTML／數值證據：`output/pdf/gate2/`。

既有 Overview 的 Average Delivery Progress 維持原行為（整數與既有缺值處理）。缺觀測例舊卡 30% 與新 Current Completion 36.4% 並非相同 metric；新的 Browser／PDF Current Completion 完全相同。為遵守既有 Production 行為保護，沒有把舊卡改成新定義。

## Production 安全與讀取成本

Production `renderOverviewPrintReport` 保持 PR #53 還原結果；完整 Production function invariants、exact UAT feature stripping 與權限測試通過，未增加 invariant exception。無 Rules、IAM、CORS、service account、archive edit permission、Manage Weeks permission 或 cloud resource 修改。原 PR #52／#53 分支與 foundation 不變；只有 candidate 推送及 Draft PR。

Browser 利用既有已授權 subscription，沒有新增 query；metadata 更新用於辨別快照完整性。server-complete 只證明 query 已完整，7／13 個日曆觀測不足仍回報 partial／missing warnings，絕不補零。

PDF 歷史 reader 以 document ID 分頁，每頁 50、最多 6 頁／300 文件，順序查詢；不是讀到 7／13 週就停止。需短頁才能證明 complete；最後一頁恰滿 50，或超過上限時 complete=false，輸出 unavailable／history-read-limit，不把截斷資料當成功。

- 若 eligible history 僅 7／13 份，額外讀取約 7／13 文件（情境估算，非 Production 觀測）。實際常態等於 eligible history 的總量 N，上限 300。
- N=50 時需第二個空查詢確認結束；Firestore 有最低 query 計費，因此 billed reads 可能高於返回文件數。
- 每個新區塊 export 另加上述歷史 reads；既有 user／anchor／settings reads 通常 3，其他已選區塊仍有自己的 reads。
- 功能現階段關閉，因此沒有啟用新 Production 讀取或費用。未量測 live usage、帳單、index-entry charges，不估造金額；Firestore 的文件／index-entry／網路計費仍需 UAT 階段觀察。[官方計費說明](https://firebase.google.com/docs/firestore/pricing)
- source deploy script timeout 設為 120 秒；實際 deployed timeout 未查詢。最壞六次順序 Firestore requests 加 Chromium rendering 有超時風險，本地合成成功無法替代 UAT P95 與接近上限資料量驗證。沒有調整 timeout 或 infrastructure。

## 後續 UAT 條件

1. Control Plane 接收 Claude 的獨立 QA，必要時修復其具體 finding。
2. 另行授權 UAT deployment，確認實際後端功能、registry／build identity 與前端 verification；本 PR 不啟用功能。
3. 真實 UAT 歷史資料比對：角色、released policy、7／13 週觀測、baseline／legacy identity／缺資料警告。
4. 量測實際 export 延遲（包含 P95）與最大資料量讀取／費用；300 上限截斷須保留 unavailable 行為。
5. Production merge／部署需獨立明確授權。

## 驗證記錄與限制

2026-10-15：latest QA 匯入後 root 1,595 PASS／3 SKIP、PDF 455 PASS，兩種 Hosting build、package parity、linux/amd64 Docker build 與 network-disabled renderer smoke 通過。Rules 46 項與 Functions 229 項已在同次候選驗證執行；QA 新提交未修改 Rules／Functions。

新 Gate 2 差異的第一次獨立 review 與修正後 recheck 均 PASS。追加 e06da6e 的窄範圍 review 僅完成程式檢查，review agent 因 usage limit 未完成最終測試回覆；不將此部分宣稱完整獨立 PASS。主執行者已完成同一最終版本的 full root／PDF suite。Claude 的整體獨立 QA 接收仍待 Control Plane 驗收。

Routing：Codex，GPT-6.1 Sol／High（依指定）；沒有 provider switching。Actual token／credit cost：N/A — telemetry unavailable。
