> Updated product scope: [Archive restoration](../superpowers/specs/2026-10-15-archive-scope-restoration.md). Archive management remains outside Draft Publish; English labels replace previous Chinese UI labels. See the 2026-10-15 Archive restoration report for current verification.

# 統一「存成草稿／存檔並發布」驗收報告

更新日期：2026-10-15（Asia/Singapore）。狀態：READY FOR REVIEW；CI 最終確認待完成；未合併／未部署。

## 本次行為

依使用者最新指示，取代先前新舊專案分流。所有可編輯的新專案及既有專案，在同一個編輯畫面都有兩個完整文字按鈕：

- **存成草稿**：保存目前輸入，可跨週、重新登入後繼續編輯；不改正式週次、Overview 或 PDF。
- **存檔並發布**：一次交易保存目前表單並更新指定、尚未 Release 的正式週次。驗證或稽核寫入失敗時，草稿與正式資料都不提交。

My Drafts 只負責繼續編輯，不必經由另一個畫面才發布。PDF、Overview、趨勢與週次承接均讀取正式快照，沒有把工作草稿混入報表。

舊專案第一次存草稿才建立工作記錄，不預先批次搬移，也不在開啟／存草稿時修改正式專案。原本可編輯既有專案的 PM 不需要新增專案權限；真正新建專案仍沿用 project.manage。Admin／正式負責人及 canonical email 草稿 ACL 由伺服端驗證；原始姓名對應不唯一時，首次採用須由 Admin 明確處理。

已 Release 週次、封存／隱藏狀態、刪除／還原衝突與歷史週次限制仍保留。原 UAT Save／Attention 直接改正式內容的路徑也被阻擋，避免只有 UI 改名卻仍能繞過。

## 自動驗證

| 項目 | 結果 |
|---|---|
| 主測試 | 1,540 通過、0 失敗；2 項既有 emulator-only 略過（另有明確 emulator suites） |
| Firestore Rules | Production 15 + UAT 17 + shared backend 17，合計 49 通過、0 失敗、0 略過 |
| PDF 完整測試 | 404 通過、0 失敗、0 略過 |
| UAT／Production 建置 | 均通過；Production 原有介面基準未放寬 |
| Production → UAT 同步邊界 | 通過；未執行雲端同步 |
| 差異／格式檢查 | 通過 |

實際 callable 與報表讀取測試驗證：既有正式 40% → 草稿 75% 時 Overview／PDF 仍為 40%；目前表單改成 85% 並存檔發布後，兩者同為 85%，專案數仍為一筆。另涵蓋新專案未發布不入報表、原有不明欄位保留、權限撤銷與清單保護、版本衝突、首次發布重試與稽核失敗整批回滾。

## 本機畫面與操作

使用獨立 Firebase Auth／Firestore／Functions emulator、虛構帳號與測試資料。沒有使用正式資料驗證功能。

- 既有專案正式 25%；存成 75% 草稿後，總覽仍為 25%。重新開啟保留 75%。
- 編輯中的目前內容改成 85%，直接按「存檔並發布」後，總覽為 85%，沒有先發布舊草稿 75%。
- 新專案未填名稱、代碼也可先存草稿；補齊資料後，在同一個編輯畫面發布為 30%。
- 新舊專案的按鈕文字、尺寸及排列一致；沒有把文字塞回原本的 32px 圖示按鈕。
- 首次發布後專案代碼改為唯讀，避免僅因鎖定欄位就誤報「尚未儲存」；真正於請求期間繼續輸入的內容仍保留未儲存提醒。

先前 browser/native 讀取中斷，以及殘留本機程序曾影響驗收；改用獨立 ports 繼續，沒有終止其他服務。診斷頁僅加入錯誤顯示，未替換產品資料、權限或存檔邏輯。最終使用標準 localhost 一般入口完成登入及新專案直接發布（45%）；發布後關閉沒有未儲存對話框（count=0），不用診斷頁才可操作。另確認名稱不足時整批發布被拒絕，補齊後才成功。先前 127.0.0.1 來源的載入不穩未被武斷歸因為產品或擴充套件缺陷；最終一般入口驗收使用獨立、乾淨的本機來源。

## 獨立審查及修正

獨立 reviewer 審查 `86996bb..8a58714`；36 項重點測試通過，提出 0 Critical／1 Important／0 Minor。

Important：可新增專案的 PM 能搶佔既有專案的 deterministic source ID，造成真正負責人無法開啟，Admin 也可能取得錯誤工作稿。已保留 server `source-*` 命名空間，並在既有 source lookup 回傳前核對來源綁定；兩項實際 handler regression 均先失敗再通過。

同一修正階段也修正實際瀏覽器發現的首次發布後 false dirty 提醒；用實際 configure／serialize 函式測試先重現再通過。最終修正由實作者驗證，沒有冒稱獨立複審核准；依既定流程沒有第二次獨立審查。沒有暫緩的 Minor 項目。

Reviewer 未獨立判定：實際瀏覽器／整套 root、Rules、PDF、build、CI／雲端 IAM 與部署／真實 Firestore 多請求並發負載。本機 suites 與 CI 由實作者確認；雲端與並發負載驗收仍為 NOT_RUN。

## 實作判斷與界線

- 使用者明確要求取代新舊分流；本次依最新要求直接修訂，不再重複要求已給過的產品授權。
- 新草稿可用穩定 UUID 處理首次交易重試；既有 ACL 或新增權限仍由伺服端決定，來源與摘要不信任客戶端。
- 缺少 deputy 的舊資料正規化為空字串；未知正式欄位在發布時保留，不批次遷移。
- 首次採用前須唯一姓名對應；採用後以已儲存的 canonical email ACL 為準。後來新增同名 PM 不會自動取得工作稿，亦不會只因同名就撤銷原編輯者。正式來源改變仍受擁有權及摘要衝突保護。
- 私有草稿可在來源週次 Release 後持續保存；正式發布仍受目標週次鎖與歷史順序限制，不能回寫已發布歷史。
- Production 程式行為與部署清單界線維持；四個 UAT draft callables 仍明確禁止部署到 Production。

## 後續環境驗收

尚未執行 merge、deploy、production 寫入、資料重建、IAM／權限修改或 runtime identity 建立。實際雲端 UAT rollout 仍須另外授權，並檢查專用執行身分、最小資料庫權限、Rules、查詢 indexes 與指定 UAT Functions／Hosting 的一致部署。

狀態僅為可供審查，並非 READY／AUTHORIZED FOR PRODUCTION。

路由：Codex 持續使用原隔離 clone；一次 GPT-6.1 Sol High 獨立審查，沒有跨 provider 切換或升級模型。精確 token／費用：N/A — telemetry unavailable。
