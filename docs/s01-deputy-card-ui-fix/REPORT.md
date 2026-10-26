# S01 Deputy / Card UI 本機修正

A. BUG-01 ROOT CAUSE：快開editor使用的目錄只保留PM；hydration只給Primary PM額外補Admin-self，因此Deputy缺自己。後端resolveAssignment同時以ownerEmail限定Admin-self，不能只改下拉UI。另舊PM filter未排除active=false/disabled=true。

Owner明確決定：只允許目前Admin選自己，其他Admin仍不得選。新增同一份browser/Functions eligibility contract，正規化role/email、檢查啟用狀態與去重，套用兩個selector與後端交易內assignment validation。沒有角色／權限寫入；PM仍不能提交assignment。既有Deputy只有使用者儲存才改，不可選的現有值保留disabled current assignment。

B. BUG-02 ROOT CAUSE：card-actions絕對定位在右上角，和狀態區各自排版；原padding-right只為一個按鈕留空，Edit+More會覆蓋badge。改將actions放進card-summary-right正常flex流，允許換行，文字可斷行。不加offset/z-index補丁、不改status語意。1440/1024/768/390/320px的三種現有RAG狀態皆實測。

C. EXACT FILES MODIFIED：見CHANGED_FILES.txt。產品檔只有index.html、functions/project-drafts-core.js與browser/Functions兩份小型eligibility helper；其他皆對應測試、精確delta與證據。原既有Auth/SSO邏輯、Rules、callable actor authorization與runtime config未更動。

D. LOCAL COMMIT SHA：本文件包含於提交；exact SHA於外部交付報告與COMMIT.txt記錄，避免提交自我參照。父提交固定PR79，分支codex/s01-deputy-card-ui-fix，沒有推送。

E. TEST RESULTS：相關測試231/231 PASS、0skip；新問題browser16/16、Admin-self11/11、S01 flows28/28，全數pageErrors=[]。兩份Hosting profile各40檔build PASS。未重跑無關PDF/SSO全套、未跑新SHA hosted CI。修正前backend7項中3FAIL證實Admin-self Deputy／inactive或disabled PM缺陷；修正後通過。歷史hash不變，以6個唯一精確delta還原PR79 HTML；負向修改/缺失/重複與無關權限變動仍會被攔截。

測試適應：舊案例要求拒絕Admin-self Deputy，現依Owner核准改為拒絕other Admin；保留同樣的no-write／輸入保留／控制復原斷言。VM fixture改用實際shared eligibility產生self選項，非假設補入。guard wrapper先精確回復PR79後再驗證舊來源，實際行為測試仍讀目前產品。

F. BEFORE/AFTER UI EVIDENCE：evidence/before與after各含Deputy展開、desktop及390/320px卡片截圖、完整幾何檢查JSON。before確認5寬度皆有overlap；after 5寬度皆無重疊、按鈕命中正常。截圖只含合成身分。

G. PR79/PR80 INTEGRATION IMPACT：本次未改PR79/80。PR80仍基於原PR79；本分支不是可取代SSO的整合候選。若未來基底納入本修正，PR80必須吸收更新、處理imports/目錄/guard重疊並針對新SHA重跑CI及相關SSO安全驗證。任何既有分支更新/retarget由Control Plane另定。詳QA_HANDOFF.md。

H. REMAINING RISKS：本機證據不等於實際UAT驗收；停用辨識依users.active/disabled，不是live Auth盤點；沒有核對或更改live帳號。未更動S02綁定防護及其7份UAT authUid移轉阻塞。新source SHA仍待獨立QA/後續CI，不能宣稱已部署或已被Owner接受。

I. FINAL GO/HOLD：S01_UAT_UI_FIX_LOCAL_READY（本機修正與驗證完成，建議送Control Plane審查）。沒有push、PR、merge、deploy、Auth／角色／權限／真實資料／雲端配置變更。
