# QR 連結產生器

> 輸入網站連結，一鍵產生高畫質 QR Code — 純前端、即時預覽、支援 PNG / SVG 下載

**線上體驗**： https://ymguan3-boop.github.io/qr-platform/

---

## 功能

- **僅保留「網站連結」QR Code**：聚焦單一、高頻使用情境
- **純前端運算**：使用 `qrcode` 在瀏覽器本地產生，不會將網址上傳至任何伺服器
- **即時預覽**：輸入即產生，支援 160–640px 預覽尺寸調整
- **外觀自訂**：前景色 / 背景色 + 3 組快速主題
- **進階參數**：邊距（0/1/2/4）、容錯等級（L/M/Q/H）
- **高畫質下載**：PNG（1024×1024）、SVG（向量）
- **靜態部署**：可直接部署至 GitHub Pages，無需後端

## 技術

- React 18 + TypeScript + Vite 6
- Tailwind CSS
- `qrcode`（瀏覽器端 canvas / SVG 產生）
- GitHub Actions → GitHub Pages 自動部署

## 本地開發

```bash
cd client
npm install
npm run dev      # http://localhost:5173/qr-platform/
npm run build    # 輸出至 client/dist
```

> Vite `base` 已設為 `/qr-platform/`，對應 `https://<帳號>.github.io/qr-platform/`。本地開發會自動處理。

## 部署

本專案已設定 `.github/workflows/deploy.yml`，推送至 `main` 分支即自動建置並部署至 GitHub Pages。

首次使用需至 GitHub： **Settings → Pages → Build and deployment → Source: GitHub Actions**。

## 專案結構

```
qr-platform/
├── client/           # 純前端 QR 產生器（GitHub Pages 部署此目錄）
│   ├── src/App.tsx   # 單頁主程式
│   ├── vite.config.ts # base: /qr-platform/
│   └── dist/         # 建置輸出
├── electron/         # （保留）桌機版外殼，未用於 Pages 部署
├── server/           # （保留）桌機版後端，未用於 Pages 部署
└── .github/workflows/deploy.yml
```

## 授權

MIT
