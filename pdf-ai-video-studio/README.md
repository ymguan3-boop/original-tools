# PDF 智慧影音製作系統 — Windows 桌面版

**本工具僅發布 Windows x64 可攜式桌面版。已取消原本的輕量線上操作版。** 使用者下載 ZIP，完整解壓縮後雙擊 EXE，即由本機伺服器開啟 HTML 工作台；原本的舊版 pdf-voice-video 不受影響。

- **Windows 下載 ZIP**：https://ymguan3-boop.github.io/original-tools/pdf-ai-video-studio/pdf-ai-video-studio-desktop.zip
- **原創工具集首頁**：https://ymguan3-boop.github.io/original-tools/
- **程式原始碼**：https://github.com/ymguan3-boop/original-tools/tree/main/pdf-ai-video-studio

## 第一次啟動（使用者不需手動輸入指令）

1. 下載 Windows ZIP，**完整解壓縮**到可寫入的資料夾，例如文件資料夾。
2. 雙擊「啟動PDF智慧影音.exe」。程式會先檢查**電腦是否有 Python 3.10–3.14**，優先使用 3.12 或 3.13。檢查的是可用的 Python 執行環境，不會自行變更其他應用程式的 Python。
3. **未找到相容 Python**：顯示繁體中文提示及官方網址，按「是」開啟 https://www.python.org/downloads/windows/ 。請選 Python 3.12／3.13 的 Windows x64 安裝版本。安裝完成後重新啟動桌面版。
4. **已有相容 Python**：程式在自己的 local-service/.venv 建立虛擬環境。若缺少 edge-tts、httpx 等套件，會先詢問同意，才從 PyPI 安裝。第一次操作需要網路。
5. 服務成功啟動後，程式自動開啟 http://127.0.0.1:8765/pdf-ai-video-studio/ ，這是**只有本機可以使用的 HTML 網頁**，不是公開線上版本。
6. 可匯入 PDF、編輯逐頁文案、產生 TTS、設定 BGM、分鏡及輸出 WebM；AI 撰稿可選用 Ollama 或自己的 OpenAI 相容 LLM API 設定。

**重要：** 這是「ZIP 可攜式桌面程式」，不是 MSI 安裝精靈。ZIP **未內建 Python**；Python 缺少時須由使用者自行安裝，不能只解壓 ZIP 就期待 Python 功能可執行。

## 程式依賴項目與檢查方式

| 項目 | 何時需要 | 如何檢查 | 若缺少 |
|---|---|---|---|
| Python 3.10–3.14 | 本機 HTML 服務、AI 文案、Edge-TTS | EXE 啟動時偵測 Python 版本 | 會彈出視窗提供 [Python 官方 Windows 下載](https://www.python.org/downloads/windows/) |
| edge-tts / httpx | 文字語音轉檔及 LLM | EXE 檢查獨立 venv 裡的套件 | 取得使用者同意後由 pip 安裝 |
| ComfyUI | 只有 AI 影片／數位人選裝模型才需要 | HTML 工作台測試 127.0.0.1:8188 的本機 ComfyUI API | 顯示未連線，提供 [ComfyUI 官方下載](https://www.comfy.org/download) |
| Wan2.2／MuseTalk／SadTalker 權重與 API 工作流 | 使用該模型時才需要 | HTML 顯示對應工作流是否就緒；須實際測試模型 | 依下方官方連結自行安裝與確認權重授權 |

**ComfyUI 未連線 ≠ 一定未安裝。** 若已安裝 ComfyUI 但沒有啟動，請先啟動；本版本固定使用 8188 埠；若 ComfyUI Desktop 使用其他埠，請將 ComfyUI 本機 API 改為 8188，或由維護者調整本程式的 engine_service.py 連線設定。**ComfyUI Desktop 及官方 Portable 可能自行附帶或管理 Python**，不代表它一定需要額外安裝系統 Python；本程式自己的 EXE 啟動器仍會獨立檢查 Python。

模型官方來源：
- ComfyUI：https://www.comfy.org/download
- Wan2.2：https://github.com/Wan-Video/Wan2.2
- MuseTalk：https://github.com/TMElyralab/MuseTalk
- SadTalker：https://github.com/OpenTalker/SadTalker

模型及工作流是**可選裝項目**，不會在未經同意下偷偷下載數十 GB。進階模型需確認 GPU 顯存、磁碟、第三方節點與使用授權。

## 功能內容

1. AI 逐頁口語文案：PDF.js 擷取可讀文字，LLM 建議文案需人工核對數據、圖表和法令。
2. Edge-TTS：支援臺灣中文男／女聲，直接生成 MP3 並混合入錄影音軌，毋須分享螢幕系統音訊。Edge-TTS 不需 API Key，但需要連網並傳送旁白文字給服務方。
3. BGM：使用者自行選擇有合法授權的音樂，支援循環、音量調整和配音時降低音樂音量。
4. 逐頁分鏡與影片模板：三種 HTML 模板、16:9／9:16／1:1，保留原始 PDF 比例，以 Canvas + MediaRecorder 輸出 WebM。
5. 選裝 AI 動態影片／數位人：連接本機 ComfyUI，提交使用者審核過的 API format 工作流；可將產出影片作為逐頁「AI 生成示意」，不得當成正式查核證據。

**目前不保證**所有 Wan2.2／MuseTalk／SadTalker 工作流已安裝或已完成端到端驗證。工作流放在 local-service/workflows/，詳見當中的 README。此 ZIP 不含模型權重，亦沒有自動下載模型的安裝精靈。

## AI LLM 設定

只需在下載的桌面版資料夾內，把 local-service/.env.example 複製成 local-service/.env，填入 LLM_BASE_URL、LLM_MODEL、LLM_API_KEY（視供應商要求）。

可使用 Ollama 本機 OpenAI 相容 API；或填入現有 Free LLM API 的真實端點、模型 ID 和統一金鑰。請勿把自己的 API 金鑰提交到公開 GitHub。

## 資安與限制

- 只在本機 127.0.0.1:8765 開啟 HTML 工作台，前端沒有線上部署；本機 API 經限制 Host、Origin 和檔案路徑。
- 原始 PDF 與 BGM 保留於本機瀏覽器；AI 撰稿會把選取的 PDF 文字交給自訂 LLM，Edge-TTS 傳送旁白文字到語音服務。如選擇 ComfyUI，則會將選定的圖片及配音傳入本機 ComfyUI。
- 工作流應自行審核與測試；不要使用不明第三方節點、自動安裝未知的程式碼或執行來路不明的安裝包。
- 掃描影像 PDF 沒有 OCR；AI 文案不應擅自解讀 PDF 中無法擷取的工程圖表。
- 現階段輸出 WebM，不是 MP4；瀏覽器與顯示卡支援度仍需實際 Windows 測試。
- 已有 GitHub Actions 的 JavaScript、Python 安全單元測試和 Windows EXE 編譯／ZIP 組包檢查。**自動建置成功不等於所有使用者電腦都已完成端到端驗收。**

## 創作者與授權

創作者：官毅明。原創工具集採 MIT 授權；ComfyUI、模型權重、聲音與素材各依其授權使用。
