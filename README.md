# 原創工具集 — original-tools

> 收錄個人原創工具，透過 GitHub Pages 以子路徑統一部署。多數工具為純前端；需要即時連線的工具會使用安全的外部後端。

**創作者**：官毅明

**線上總覽**： https://ymguan3-boop.github.io/original-tools/

---

## 工具一覽

| 工具 | 說明 | 線上連結 | 原倉庫 |
|------|------|----------|--------|
| **QR 連結產生器** | 輸入網址即時產生高畫質 QR Code，支援顏色/尺寸/邊距/容錯等級，PNG/SVG 下載 | [開啟](https://ymguan3-boop.github.io/original-tools/qr-platform/) | [qr-platform](https://github.com/ymguan3-boop/qr-platform) |
| **PDF 轉語音影片模組** | 匯入 PDF 自動偵測底線段落，中文語音逐段朗讀 + 黃色高亮字幕，錄製為 WebM 影片 | [開啟](https://ymguan3-boop.github.io/original-tools/pdf-voice-video/) | [pdf-voice-video](https://github.com/ymguan3-boop/pdf-voice-video) |
| **手機遠端協助工作台** | 4 位數配對、手機鏡頭、雙向語音、文字訊息及即時畫面標記 | [開啟](https://ymguan3-boop.github.io/original-tools/mobile-remote-assist/) | 本倉庫 `mobile-remote-assist/` |

> QR 與 PDF 工具皆為純前端。遠端協助工具的靜態前端部署於 GitHub Pages，配對與短效 LiveKit 憑證由既有 Sites 後端安全提供；秘密金鑰不在本倉庫。

## 倉庫結構

```
original-tools/
├── index.html              # 集合首頁（總覽 + 導向）
├── qr-platform/            # 由 D:\opencode_0519\qr-platform 複製（排除 node_modules/dist）
│   └── client/             # 前端原始碼，部署時自動建置
├── pdf-voice-video/        # 由 D:\opencode_0519\pdf-voice-video 複製
│   ├── index.html
│   ├── lib/pdf.min.js
│   └── ...
├── mobile-remote-assist/    # 手機遠端協助 GitHub Pages 前端
│   ├── index.html
│   ├── helper.html
│   ├── mobile.html
│   └── ...
└── .github/workflows/deploy.yml  # 建置並部署至 Pages
```

## 本地開發

```bash
# 集合首頁（靜態，無需建置）
open index.html

# QR 工具（需建置）
cd qr-platform/client
npm install
npm run dev      # http://localhost:5173/original-tools/qr-platform/
npm run build

# PDF 工具（純靜態）
open pdf-voice-video/index.html

# 遠端協助前端（需透過 HTTP 伺服器開啟，不能直接雙擊檔案）
npx serve .
```

## 部署

已設定 `.github/workflows/deploy.yml`，推送至 `main` 即自動：
1. 安裝並建置 `qr-platform/client`（`base: /original-tools/qr-platform/`）
2. 組裝 `deploy/` 目錄：集合首頁、QR 建置輸出、PDF 工具及遠端協助前端
3. 透過 `actions/deploy-pages` 發布至 `https://ymguan3-boop.github.io/original-tools/`

首次使用需至 GitHub： **Settings → Pages → Build and deployment → Source: GitHub Actions**（已由 CLI 自動設定）。

## 維護

- 原倉庫（`qr-platform`、`pdf-voice-video`）仍獨立維護；本倉庫為彙整發行用。遠端協助程式的秘密設定只存在伺服器端，不得提交到 GitHub。
- 新增工具：複製至子目錄，並在 `index.html` 與 `README.md` 加入卡片，最後同步 `deploy.yml`。

## 創作者

官毅明

## 授權

MIT
