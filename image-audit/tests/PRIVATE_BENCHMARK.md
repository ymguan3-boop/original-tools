# 工程照片真實驗收資料集｜私人回歸測試（不公開照片）

## 來源與保護原則
本案例由使用者提供三批共 27 張原始照片。原檔與檔名配對 manifest 放在**使用者本機的** `engineering_photo_private_benchmark_v1.zip` 中。公開 GitHub 倉庫**不存放**這個 ZIP、照片或可還原的圖像內容；GitHub Pages 與桌面安裝 ZIP 也不打包此資料集。本檔為開發者測試指南，不會放在前端操作說明裡。

若需將此資料集接入雲端自動化，必須先由倉庫管理者提供具有適當權限與加密的私人測試儲存空間及受保護的 CI 憑證。**目前 GitHub Actions 僅自動跑公開的合成影像測試、程式編譯及測試器契約；真實 27 張照片不會在 Actions 上自動下載或執行。**

## 私人資料集結構
- `manifest.json`：檔案數、資料夾、243 組跨組配對、9 組**獨立確認的同一原始影像配對**、逐檔 SHA-256、v2.5.0 報告基線。
- `photos/第一批次/`、`photos/第二批次/`、`photos/第三批次/`：每批九張 PNG。
- `README_PRIVATE.txt`：本機執行方法及隱私提醒。

僅標註 9 組「已獨立確認同源」；其餘 234 組並未全部經人工驗證為不同來源，**不應直接當成標註的負樣本**。

## 本機自動驗收命令

```bash
python image-audit/tests/private_photo_benchmark.py --dataset /private/engineering_photo_private_benchmark_v1.zip --web-report /reports/web.docx --desktop-report /reports/desktop.docx --min-web-recall 6 --min-desktop-recall 8
```

可另外以 OpenCV（只供開發測試，**不打包進桌面程式**）作獨立基準：

```bash
python image-audit/tests/private_photo_benchmark.py --dataset /private/engineering_photo_private_benchmark_v1.zip --reference-sift
```

## 本輪驗收記錄（2026-11-01）
兩份 v2.5.0 報告均載明三資料夾、27 張照片、243 組配對、共同門檻 50%。網頁版入選 6 組、桌面版入選 8 組（其中兩組幾何補列），共同入選的六組分數一致。獨立 OpenCV SIFT／RANSAC 檢查找到 9 組同一原始影像內容。這份資料集上的 baseline 為網頁 6/9、桌面 8/9；下一次版本應朝 9/9 改善，但**不能以這 27 張照片推估通用準確率**。

已確認的遺漏：桌面版漏「尿斗施工後」；網頁版另漏「戶外地面施工前」、「垃圾桶施工中」。2026-11-01 的照片為真實工程資料，不得因程式測試用途擅自公開或外傳 OpenRouter。
