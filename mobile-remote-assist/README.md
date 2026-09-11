# 手機遠端協助工作台

製作人：官毅明

這是網頁版手機遠端協助工具。手機端建立 4 位數協助代碼後，可分享鏡頭與語音；電腦主控台能觀看即時影像、雙向通話、傳送文字訊息，並在畫面上進行即時標記、復原及清除。

## 線上使用

- [角色選擇頁](https://ymguan3-boop.github.io/original-tools/mobile-remote-assist/)
- [電腦主控台](https://ymguan3-boop.github.io/original-tools/mobile-remote-assist/helper.html)
- [手機端](https://ymguan3-boop.github.io/original-tools/mobile-remote-assist/mobile.html)

## 使用規則

- 每個工作階段只允許 1 位協助人員加入。
- 5 分鐘沒有活動、主控台停止連線或建立滿 30 分鐘後，工作階段失效。
- 網頁版只分享手機鏡頭，不包含整個手機系統畫面；完整系統畫面分享需要原生 Android／iOS 應用程式。
- 請勿將協助代碼提供給不明人士，也不要在鏡頭前展示密碼或敏感資料。

## 架構與費用

GitHub Pages 提供靜態前端；配對 API 與短效 LiveKit 憑證由既有 Sites 後端提供。LiveKit API Secret 不會下載到瀏覽器，也未存放於本倉庫。

即時媒體使用 LiveKit Cloud Build 免費方案。免費額度是硬上限，耗盡後新連線會失敗，不會由本程式自動升級或產生超額費用。請在 LiveKit 後台確認帳戶仍維持 Build 方案。

## 保留檔案

- `index.html`：角色選擇頁。
- `helper.html`、`mobile.html`：主控端與手機端介面。
- `app.js`：配對、文字訊息、標記及媒體控制。
- `cloud-media.js`：LiveKit 瀏覽器連線封裝。
- `styles.css`：共用介面樣式。
- `vendor/`：固定版本的 LiveKit 官方瀏覽器套件及其授權檔。

未納入 LiveKit 金鑰、網站部署憑證、暫存檔、壓縮檔、測試輸出、審計平台檔案及未完成的原生手機專案。

## 防火牆

限制嚴格的機關網路需允許 LiveKit Cloud 的安全 WebSocket 與 TURN/TLS（TCP 443）。若組織政策封鎖該服務，應由資訊人員依正式程序允許必要網域，不應關閉防火牆。

## 授權

專案程式採 MIT License；`vendor/livekit-client.umd.js` 依 LiveKit 原授權條款使用，詳見 `vendor/livekit-LICENSE.txt`。
