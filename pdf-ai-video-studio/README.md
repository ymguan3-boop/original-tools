# PDF 智慧影音製作系統 — Windows 桌面版

**本工具僅發布 Windows x64 可攜式桌面版。已取消原本的輕量線上操作版。** 使用者下載 ZIP，完整解壓縮後雙擊 EXE，即由本機伺服器開啟 HTML 工作台；原本的舊版 pdf-voice-video 不受影響。

- **Windows 下載 ZIP**：https://ymguan3-boop.github.io/original-tools/pdf-ai-video-studio/pdf-ai-video-studio-desktop.zip
- **原創工具集首頁**：https://ymguan3-boop.github.io/original-tools/
- **程式原始碼**：https://github.com/ymguan3-boop/original-tools/tree/main/pdf-ai-video-studio

## 一鍵啟動後的互動式引導（新）

**操作順序：** 下載 ZIP → 完整解壓縮 → 雙擊 `啟動PDF智慧影音.exe` → 確認 Python → 在使用者同意後安裝必要 pip 套件 → 自動開啟本機 HTML 與首次啟動精靈。

精靈會依序引導四個階段：

1. **基本製片**：確認 Python 本機服務、PDF.js、Web Audio 及瀏覽器 WebM 錄製能力。完成後可匯入 PDF、編輯逐頁旁白。
2. **AI 文案（選用）**：可選 Ollama 或自己提供的 Free LLM API／其他 OpenAI 相容端點，直接在 HTML 介面填入 Base URL、模型 ID、API Key，按「儲存設定」後「測試 LLM 連線」。不使用 AI 仍可手動撰稿。
3. **AI 中文配音**：可試聽 Edge-TTS，或選用 Index-TTS2 上傳自己授權的聲音樣本並確認試聽。正式匯出 WebM 前需先為各頁生成音檔。
4. **AI 影片／數位人（進階選裝）**：檢查 ComfyUI、GPU、FFmpeg、Ollama、磁碟及已審核的工作流；模型未安裝時提供官方連結，不會擅自下載數十 GB 權重。

右上角的「首次啟動精靈」可隨時重開。離線說明頁位於 `pdf-ai-video-studio/desktop/setup-guide.html`；如果 Python 缺少或虛擬環境／pip 失敗，EXE 將嘗試開啟此頁，並提供 Python 官方下載網址。

API Key 只會儲存在本機 `local-service/.env`，**這是明文設定檔，請保護資料夾及電腦帳號權限**；不會傳回瀏覽器或上傳 GitHub。金鑰可以不填（適用不需金鑰的 Ollama）。

**重要限制：** 精靈能檢查、引導和測試基本服務，但 ComfyUI 的第三方節點、Wan2.2/MuseTalk/SadTalker 模型權重與 CUDA／PyTorch 相容性仍需使用者另外安裝及實際推論驗收，不能視為全自動模型安裝包。

## 第一次啟動（使用者不需手動輸入指令）

1. 下載 Windows ZIP，**完整解壓縮**到可寫入的資料夾，例如文件資料夾。
2. 雙擊「啟動PDF智慧影音.exe」。程式會先檢查**電腦是否有 Python 3.10–3.14**，優先使用 3.12 或 3.13。檢查的是可用的 Python 執行環境，不會自行變更其他應用程式的 Python。
3. **未找到相容 Python**：顯示繁體中文提示及官方網址，按「是」開啟 https://www.python.org/downloads/windows/ 。請選 Python 3.12／3.13 的 Windows x64 安裝版本。安裝完成後重新啟動桌面版。
4. **已有相容 Python**：程式在自己的 local-service/.venv 建立虛擬環境。若缺少 edge-tts、httpx 等套件，會先詢問同意，才從 PyPI 安裝。第一次操作需要網路。
5. 服務成功啟動後，程式自動開啟 http://127.0.0.1:8765/pdf-ai-video-studio/ ，這是**只有本機可以使用的 HTML 網頁**，不是公開線上版本。
6. 在自動顯示的 HTML 精靈內檢查基本能力、設定與測試 LLM、測試 Edge-TTS；之後匯入 PDF、編輯逐頁稿、產生語音並輸出 WebM。

**重要：** 這是「ZIP 可攜式桌面程式」，不是 MSI 安裝精靈。ZIP **未內建 Python**；Python 缺少時須由使用者自行安裝，不能只解壓 ZIP 就期待 Python 功能可執行。

## 程式依賴項目與檢查方式（2026-11-01 原始碼複核）

**下載包真正內建：** Windows x64 Go 編譯的 EXE 啟動器、HTML / CSS / JavaScript、PDF.js 主程式與 Worker、本機 Python 服務的來源檔、requirements.txt、選裝 ComfyUI 接頭。**沒有**內建 Python 執行環境、FFmpeg、Chrome/Edge、Ollama、ComfyUI、PyTorch、CUDA Runtime 或模型權重。

| 項目 | 必要性 | 現行檢測與處理 | 官方來源 |
|---|---|---|---|
| Windows x64、Python 3.10–3.14 | **必要**，本機服務使用 | EXE 偵測 Python 版本；沒有時跳出官方安裝提示，首次在本程式資料夾建立獨立 venv | [Python Windows](https://www.python.org/downloads/windows/) |
| venv / pip、edge-tts 7.2.7、httpx 0.28.x（含間接依賴） | **必要**，配音與 API | EXE 檢查套件；缺少時先詢問，再用 pip 安裝；需網路，若 Python 沒有 pip 或 venv，需修復 Python | [Python pip 文件](https://pip.pypa.io/) |
| PDF.js | **必要但已隨 ZIP 打包** | 包含 pdf.min.js 與 pdf.worker.min.js；無需另外下載 | [PDF.js](https://mozilla.github.io/pdf.js/) |
| Edge／Chrome 等支援 MediaRecorder 的瀏覽器 | **必要**，HTML、WebM 與 Web Audio | HTML 會檢查 Canvas、WebM、Web Audio；不相容時引導安裝現代瀏覽器 | [Microsoft Edge](https://www.microsoft.com/edge/download) |
| FFmpeg 可執行檔 | **進階選用**：MuseTalk 官方直接推論／MP4 轉檔／部分 ComfyUI 節點 | 檢查 ffmpeg 命令是否存在於 PATH；一般 Canvas → WebM 匯出不需要獨立 FFmpeg | [FFmpeg 官方下載](https://ffmpeg.org/download.html) |
| Ollama 與本機模型 | **選用**：只有本機 LLM 文案需要；可改用既有 Free LLM API | 偵測本機 127.0.0.1:11434 API 是否回應；API 有回應**不代表已下載指定模型** | [Ollama Windows](https://ollama.com/download/windows) |
| ComfyUI | **選用**：AI 影片與數位人 | 偵測本機 127.0.0.1:8188 的 API；無回應可能尚未啟動，不能直接判定未安裝 | [ComfyUI 官方下載](https://www.comfy.org/download) |
| NVIDIA 顯示卡驅動／顯存 | **依模型需求** | 用 nvidia-smi 取得 GPU 型號、VRAM、驅動版本；未偵測不等於所有 GPU 都不可用 | [NVIDIA 驅動](https://www.nvidia.com/zh-tw/drivers/) |
| PyTorch、相容的 CUDA 執行環境、模型自訂節點 | **依 ComfyUI 工作流需求** | **尚不能由本程式保證安裝正確**，應在 ComfyUI 內對照模型／Torch／GPU 驅動並做實際推論；一般不需要為此另外裝完整 CUDA Toolkit | [ComfyUI 專案](https://github.com/comfy-org/ComfyUI) |
| Git | **依第三方節點安裝流程選用**，一般使用者不需要 | 只檢查 git 命令是否存在於 PATH；不自動 clone 不明來源 | [Git Windows](https://git-scm.com/downloads/win) |
| Wan2.2／MuseTalk／SadTalker 模型權重、API 工作流 | **進階選用** | 只檢查指定 API 工作流 JSON 是否存在；**不能保證模型權重、節點或授權已準備好** | 見下方官方模型來源 |
| 可用磁碟空間 | **必要的資源條件** | 提供所在磁碟剩餘 GB 數作為提醒；模型可能需要數十 GB 空間，實際需求依模型／工作流不同 | 不需額外軟體 |

**開發時需要、但使用者不需要安裝：** Go（在 GitHub Actions 編譯 EXE）、Node.js/npm（用於同倉庫其他工具的建置）、GitHub Actions 的 Linux Python（用於封裝 ZIP）。已編譯的 EXE 不需要安裝 Go，PDF 新版也不依賴使用者自己執行 Node/npm。

**其他相依風險：** 特定 AI 模型或 PyTorch Windows 組態可能要求 Microsoft Visual C++ 執行階段等原生元件；現行版本尚無可靠的通用檢查與自動安裝。只有收到實際缺失訊息後，才應從 [Microsoft 官方](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist) 取得相容版本。

**注意：** 上述屬於「靜態原始碼審查＋啟動時偵測」。通過 GitHub Actions 只證明編譯、測試與封裝成功，**不代表**已在全新 Windows 電腦驗證所有安裝、下載及模型推論流程。
 
**ComfyUI 未連線 ≠ 一定未安裝。** 若已安裝 ComfyUI 但沒有啟動，請先啟動；本版本固定使用 8188 埠；若 ComfyUI Desktop 使用其他埠，請將 ComfyUI 本機 API 改為 8188，或由維護者調整本程式的 engine_service.py 連線設定。**ComfyUI Desktop 及官方 Portable 可能自行附帶或管理 Python**，不代表它一定需要額外安裝系統 Python；本程式自己的 EXE 啟動器仍會獨立檢查 Python。

模型官方來源：
- ComfyUI：https://www.comfy.org/download
- Wan2.2：https://github.com/Wan-Video/Wan2.2
- MuseTalk：https://github.com/TMElyralab/MuseTalk
- SadTalker：https://github.com/OpenTalker/SadTalker

模型及工作流是**可選裝項目**，不會在未經同意下偷偷下載數十 GB。進階模型需確認 GPU 顯存、磁碟、第三方節點與使用授權。

## 自訂聲音複製：Index-TTS2（新增）

除了既有的 Edge-TTS 免費臺灣男／女聲，配音區新增 **Index-TTS2 · 複製自己的聲音**：

1. 在「語音生成方式」選擇 Index-TTS2。本功能與 Edge-TTS 分開，可隨時切換；原本的 LLM 文案、PDF 分鏡、BGM、WebM 都保留。
2. 安裝並啟動本機 ComfyUI（127.0.0.1:8188），安裝 **IndexTTS2BaseNode、VHS_LoadAudioUpload、SaveAudioMP3** 所需的可信節點與 Index-TTS2 模型。ZIP 已內建改編自 Pixelle-Video 的 `local-service/workflows/tts_index2.json` 範本，但**不包含模型權重或自訂節點**。詳細參考 [INDEXTTS2.md](local-service/workflows/INDEXTTS2.md)。
3. 上傳**自己或已取得明確授權的人聲** WAV／MP3／FLAC（最多 8MB），勾選聲音使用權與上傳同意，點「上傳並確認聲線」。
4. 先點 **「試聽自訂聲線」**；ComfyUI 會執行模型，生成短音檔，確認品質後才開始整份 PDF 配音。若模型沒有正確安裝，會呈現具體錯誤。
5. 匯入 PDF，依需要編輯逐頁文案；點「產生所有頁面旁白音檔」，系統會逐頁交由本機 Index-TTS2 推論，沿用原本的字幕、BGM、影音錄製流程。現階段每頁 Index-TTS2 **限 600 字**，長頁請先精簡或分頁。
6. 如不想使用聲線複製，切回 **Edge-TTS** 即可，不需 ComfyUI。

**本機資料保留與安全：** 上傳參考錄音與生成結果會留在使用者的 ComfyUI input / output 目錄，關閉程式不會自動刪除，請自行在 ComfyUI 清除不再使用的素材。聲音不得用於未經同意的冒充。不得將 ComfyUI 8188 埠公開到網路。模型節點存在不代表權重正確；只有**實際成功生成試聽音檔**後才能確認可用。Index-TTS2 參考工作流的 Apache-2.0 授權與修改記錄已隨 ZIP 收錄於 `third-party/`。

## 功能內容

1. AI 逐頁口語文案：PDF.js 擷取可讀文字，LLM 建議文案需人工核對數據、圖表和法令。
2. Edge-TTS 與 Index-TTS2：預設臺灣中文男／女聲、選裝本機聲線複製，直接生成旁白音檔混入錄影。Edge-TTS 會送文字至 Microsoft；Index-TTS2 使用本機 ComfyUI，但會保留錄音素材。
3. BGM：使用者自行選擇有合法授權的音樂，支援循環、音量調整和配音時降低音樂音量。
4. 逐頁分鏡與影片模板：三種 HTML 模板、16:9／9:16／1:1，保留原始 PDF 比例，以 Canvas + MediaRecorder 輸出 WebM。
5. 選裝 AI 動態影片／數位人：連接本機 ComfyUI，提交使用者審核過的 API format 工作流；可將產出影片作為逐頁「AI 生成示意」，不得當成正式查核證據。

**目前不保證**所有 Wan2.2／MuseTalk／SadTalker 工作流已安裝或已完成端到端驗證。工作流放在 local-service/workflows/，詳見當中的 README。此 ZIP 不含模型權重，亦沒有自動下載模型的安裝精靈。

## AI LLM 設定

可直接使用首次啟動精靈的表單儲存和測試 LLM。進階使用者也可自行將 local-service/.env.example 複製為 local-service/.env，填入 LLM_BASE_URL、LLM_MODEL、LLM_API_KEY。

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
