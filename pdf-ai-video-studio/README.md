# PDF 智慧影音製作系統（PDF AI Video Studio）

**正式入口：** https://ymguan3-boop.github.io/original-tools/pdf-ai-video-studio/

本工具是原創工具集的新程式，不會覆蓋原來的 PDF 轉語音影片模組。

## 四大核心功能

1. **AI 逐頁撰稿**：使用 PDF.js 擷取頁面文字；經本機服務呼叫使用者自己設定的 OpenAI 相容模型（例如 Free LLM API、Ollama），產生各頁可手動校訂的繁體中文講稿。
2. **Edge-TTS 語音檔**：本機服務產生每頁 MP3，提供臺灣男聲、臺灣女聲、一般中文男聲，瀏覽器可直接將音訊合成影片，不必再分享整個螢幕錄取系統音訊。Edge-TTS 不需 API Key，但需連線 Microsoft 服務。
3. **BGM 智慧混音**：使用者挑選自己擁有合法使用權的音樂，支援循環、開頭淡入，以及旁白時降低 BGM 音量，不需要音樂 API Key。
4. **自動分鏡／影片模板**：每頁一個分鏡，以音檔長度控制換頁、字幕、畫面與音效，提供三款模板及 16:9、9:16、1:1，輸出含音軌的 WebM。

並保留 PDF 底線候選標記導讀、自訂逐頁旁白、PDF 原始圖表比例與逐頁文字稿下載。

## GitHub Pages 使用方式

開啟上方網址，匯入 PDF，選擇旁白來源、語音、背景音樂與模板。

**不啟動本機服務：** 可檢視 PDF、建立並編輯逐頁文案、調整分鏡畫面及下載文字稿。

**啟動本機服務：** 能以 AI 生成講稿、Edge-TTS 製作 MP3，進而播放及下載有聲 WebM。

請注意：GitHub Pages 不會執行 Python；AI 和語音並非無須後端即可工作的假按鈕。瀏覽器本身不儲存 API Key。

## 安裝本機服務（Windows）

1. 安裝 Python 3.10 或更新版。
2. 開啟原始碼的 pdf-ai-video-studio/local-service 資料夾。
3. 如需 AI 撰稿，將 .env.example 複製為 .env，填入 LLM_BASE_URL、LLM_MODEL，以及該供應商要求的 LLM_API_KEY。
4. 雙擊 start.bat。首次啟動會建立獨立 .venv 並安裝必要依賴。
5. 保持命令列視窗開啟，再開啟上述 GitHub Pages 網址；右上本機狀態按鈕可以重新檢查連線。
6. 操作順序：匯入 PDF → AI 撰稿或自訂 → 核對文案 → 產生旁白 → 加入 BGM → 選擇模板 → 預覽 → 匯出影片。

macOS / Linux：在本機終端執行 sh local-service/start.sh。

### 可選的 LLM 設定

- Ollama：LLM_BASE_URL=http://127.0.0.1:11434/v1；LLM_MODEL=llama3.2；LLM_API_KEY 可以留白。要先安裝 Ollama 並下載模型。
- Free LLM API：必須填入你現有供應商真正提供的 OpenAI 相容 Base URL、模型 ID 及實際統一金鑰。這裡不會臆測未核對的 API 網址。
- 其他支援 OpenAI Chat Completions 格式的 HTTPS 服務亦可使用。

## 本機整站測試

在 original-tools 倉庫根目錄先執行 python -m http.server 8777，開啟 http://127.0.0.1:8777/pdf-ai-video-studio/ ，並另外啟動 local-service 的本機服務。

## 資安與隱私

- PDF 檔案與 BGM 音檔只在瀏覽器處理，不上傳本機服務。AI 撰稿時才會把頁面文字交給本機服務，並由本機服務傳至所設定的 LLM。TTS 會把旁白文字送至 Microsoft 線上語音服務。
- 涉及未公開審計案件、個資或保密文件時，必須有權使用外部服務；否則請選擇合規的本機模型／語音處理方式。
- 本機服務只監聽 127.0.0.1:8765，有 Origin 白名單、語音白名單、JSON 大小限制；沒有任意路徑下載 API；切勿將它開放到公網。
- 真正的金鑰僅由 local-service/.env 或本機環境變數讀取；請勿將 .env 上傳到 GitHub。
- 只部署 index.html、style.css、app.js 至 GitHub Pages，Python 本機服務不隨網站公開部署。
- 參考 Pixelle-Video 的模組化思路，沒有複製其未修補的 FastAPI 檔案存取路由。參考來源：https://github.com/ATH-MaaS/Pixelle-Video （Apache-2.0）。
- 若瀏覽器的 Local Network Access 政策阻止 GitHub Pages 連接 localhost，可改用前述本機整站測試方式；不要關閉安全保護。

## 技術及限制

- 影片目前輸出 WebM（依瀏覽器可用 VP9/Opus 或 VP8/Opus），不是 MP4。
- PDF.js 僅擷取可讀文字。掃描版 PDF 沒有 OCR；圖片／圖表不傳送給 LLM，生成內容必須人工核對。
- 底線為矩形幾何的候選偵測，不保證所有 PDF 版面都能正確擷取。
- Edge-TTS 回傳字詞時間標記，現階段字幕使用分鏡音檔進度估算切換，不是嚴格逐字強制對齊。
- 須以桌面 Chrome / Edge 驗證 MediaRecorder、WebM、背景音樂及本機服務。行動版可能不支援某些功能。
- Web 頁面共用舊版 pdf-voice-video/lib 的 PDF.js 主程式和 worker，不另複製大型函式庫。
- tests/test_security.py 提供簡易白名單／URL 安全測試，CI 另檢查 JavaScript、Python 語法。仍需在真實瀏覽器做端到端測試。

## 創作者與授權

創作者：官毅明。原創工具集為 MIT；第三方語音模型、音樂、PDF 及各模型 API 遵循各自授權與使用條款。
