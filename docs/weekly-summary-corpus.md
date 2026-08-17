# Weekly Summary corpus

這個 corpus 是可重現的 Weekly Summary 貼上、儲存與 PDF 合約閘門。它不依賴公司 Copilot 或 Gemini 的原文，也不要求把公司內容複製到測試環境。

目前固定包含 20 個虛構週次、每週 5 類共 100 案：

- 20 個 canonical 輸入
- 20 個 presentation-variant 輸入（可自動修正）
- 20 個 packed-movement 輸入（同列 `Movement`、`Blocker`、`Next step`）
- 20 個 packed-heading-and-ask 輸入（同列 heading 與 management ask）
- 20 個 safety-negative 輸入（缺欄位、重複、倒序、空值、混用欄位族群、未知專案、歷史專案管理要求、Markdown、表格、超過四個 asks）

因此預期結果是 80 案接受、20 案阻擋。每個接受案例都會檢查：

1. 瀏覽器正規化後得到指定 canonical text。
2. correction 數量達到該案例最低門檻。
3. PDF Weekly Summary contract 接受 canonical text。
4. 對 canonical text 再跑一次正規化時，修正數為零。

另外，`buildDeterministicPackedMutations()` 會產生 1,000 個 deterministic packed 變體，逐一驗證可接受、canonical 結果一致且二次正規化為零修正。

執行：

```sh
node --test tests/weekly-summary-corpus.test.mjs
```

瀏覽器端只會自動展開完整且順序明確的 packed 欄位。缺欄位、重複、倒序、空欄位或混用 movement/management 欄位族群會原樣保留並阻擋儲存；這是為了避免猜測 AI 輸出而寫入錯誤資料。成功自動修正時，畫面會以 accessible dialog 告知修正類型。

PDF service 只接受瀏覽器儲存的 canonical text，不在 PDF 階段猜測或改寫。若 packed 原文或缺欄位內容繞過瀏覽器直接進入 PDF service，會回傳 422，而不是產出空白或不完整 PDF。

公司端操作只需要一次正常貼上；只記錄 `saved`、`saved-with-correction` 或 `blocked` 結果。若要補充公司 Copilot 的觀察，請只描述結構形狀（例如「heading 與 Portfolio Summary 同列」），再轉成虛構 fixture；不要貼出公司專案名稱、數值或原文內容。

這個閘門可以證明目前定義的 100 案與 1,000 個變體，而不能宣稱任意未來 AI 輸出都一定可接受。遇到新的結構形狀時，應新增匿名化 synthetic case，並維持 PDF parity 測試。
