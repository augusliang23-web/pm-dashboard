# S02 UAT-only / Admin-only Google SSO

A. UAT_ONLY_ARCHITECTURE：新隔離本機分支codex/s02-uat-admin-only，整合固定PR80 6fc44981b33c762db787e46ffd8f66c545f3330b與PR81 cf21ca4fe0ad5d2cca4adaa639c7ba3380f0d7b5。15個嚴格列舉的建置區塊，在計算資產引用閉包之前選擇環境。正式版使用PR81原始密碼登入fallback，UAT保留獨立Admin Google入口；不是只隱藏按鈕。無新framework/OAuth backend/依賴。

B. ADMIN_ONLY_SECURITY：三份相同identity helper新增trusted role=Admin條件，仍必須匹配authUid、verified Google與Owner核准googleSubject。UAT/共享UAT Rules、24authenticated Functions與PDF邊界拒絕非Admin Google；UI也禁止PM開啟／呼叫link流程。Admin原UID/角色、PM/其他角色密碼登入與權限範圍不變。未登入不能列users目錄。沒有自動角色文件或email-only升權；純移轉planner也拒絕PM Google核准，保留PM密碼UID回填。

C. PRODUCTION_ISOLATION_EVIDENCE：Production Hosting40檔，沒有Google登入／link SDK匯入、handler、UI、identity/google-flow模組。index.html逐位元等於PR81，firestore.rules已移除PR80 SSO增量並還原同一PR81基線；雜湊見PRODUCTION_BASELINE.json。真實模擬器搭配Production產物完成密碼登入。這不等同live Production provider設定已驗證；本次沒有讀取／修改其Auth或服務。UAT產物42檔包含Admin功能。

D. EXACT_FILES_CHANGED：見CHANGED_FILES_VS_PR80.txt與CHANGED_FILES_VS_PR81.txt。包含PR81繼承修正、UAT角色政策、建置／發佈guard、測試與文件。未改既有遠端分支。歷史凍結hash不變，以唯一精確combined delta還原PR79；不存在把新政策直接寫成舊測試hash的做法。

E. TEST_RESULTS：root1986PASS/0FAIL/3原有skip（1989total）；Rules50/50；UAT安全gate5/5groups、28條結果（包含24個實際callable的錯UID及PMGoogle拒絕）；PDF相關140/140。實際Auth/Firestore/Functions＋雙context browser14/14，ProductionPassword及PM Google拒絕均包含；Deputy/Card16/16、Admin-self11/11、S01流程28/28，pageErrors全空。兩份Hosting buildPASS，main promotion負向guard正確拒絕。未跑新SHA HostedCI、未跑無關PDF全套或實際雲端驗收。

F. LOCAL_COMMIT_SHA：見外部交付報告／COMMIT.txt；本文件在提交內，避免自我參照。產品與執行guard bytes由evidence/runtime-sha256.json映射到最終提交。

G. PR81_COMPATIBILITY：保留shared eligibility、Admin-self Deputy/Primary、otherAdmin拒絕、停用PM排除、原指派保留、卡片正常流與Refresh焦點。五個文字衝突已在新本機候選逐項解決；不是GitHub PR merge。PR79/80/81/main未變。未來UAT使用此新候選重新CI/獨立QA；Production沿不含SSO的PR81或核准後繼線前進，不直接合併PR80/UAT候選進main。

H. RELEASE_GUARDS：Production產物掃描與正／負向CI測試；未知／缺失／重複標記fail-closed；main promotion CI拒絕；Hosting/PDF實際Production release wrapper拒絕本UAT-onlysource。dry-run不部署、不授權。詳RELEASE_ISOLATION.md。這不是新增IAM，不能聲稱可阻止繞過repo流程的未授權人工cloud命令。

I. REMAINING_RISKS：此新安全／建置候選尚待獨立QA與HostedCI；正式Googlechooser、人工ChromeProfiles與live UAT未驗證。所有保留UAT帳號（含PM密碼帳號）仍須先完成核准UID回填，否則嚴格UAT防護會拒絕舊帳號。先前7筆缺綁定是歷史回報，本次未重查。Production provider是否停用與雲端部署封裝／rollback均未查驗；不把client feature缺席說成已修改Production伺服器授權。任何部署／Auth／移轉／IAM須另行授權。

J. FINAL_GO_HOLD：S02_UAT_ADMIN_ONLY_LOCAL_READY，本機實作與驗證完成，建議交Control Plane及獨立QA。沒有push/PR建立或修改/merge/deploy/provider啟用/live Auth或Firestore/IAM/billing/Production變更。模擬器寫入僅合成可丟棄資料。
