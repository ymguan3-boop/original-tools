# 選用 AI 影片／數位人工作流（不隨 ZIP 內建模型）

本目錄只存放 **使用者自行審核的 ComfyUI API 格式工作流**，不接受網頁直接傳入任意 Python 代碼或任意路徑。

安裝步驟：
1. 自行安裝官方 ComfyUI https://github.com/comfyanonymous/ComfyUI ，並在 **127.0.0.1:8188** 啟動。
2. 根據 NVIDIA GPU 顯存選用模型，參考 Wan2.2 https://github.com/Wan-Video/Wan2.2 、MuseTalk https://github.com/TMElyralab/MuseTalk 、SadTalker https://github.com/OpenTalker/SadTalker 。
3. 在 ComfyUI 先完成 **可信模型與工作流** 的安裝。從 ComfyUI 輸出「API 格式」的 JSON 節點圖（普通畫布工作流不是相同格式），先在 ComfyUI 自行驗證能成功輸出 MP4 或 WebM。
4. 在模型文案文字輸入節點填入字串 __PROMPT__；如使用圖片輸入節點，將檔名設為 __IMAGE__，數位人口播工作流音檔輸入節點可將檔名設為 __AUDIO__。
5. 將確實審核與測試過的工作流放入此資料夾，依模型命名 **wan22.json**、**musetalk.json** 或 **sadtalker.json**；其他檔名不會被執行。
6. 回到本機 PDF 智慧影音 HTML 介面，點「檢查 GPU／模型」確認 ComfyUI 已連線，選模型並填寫提示詞，按生成後等待 ComfyUI 完成。

提醒：
- 本方案採「使用者自行安裝／確認模型」而不是默默下載數十 GB。不同 ComfyUI 版本及第三方節點使用的輸入名稱不同，所以 __AUDIO__ 範本必須先在本機確實驗證。
- 目前**不內建**萬用的 Wan2.2／MuseTalk／SadTalker 工作流；即使已安裝 ComfyUI，也必須另行提供相應模型的完整可執行 API 工作流。
- 模型、權重、聲音克隆及第三方節點須分別確認授權和資安；不得用於未授權人物或聲音仿冒。
- 如不需要 AI 影片或數位人，完全不必安裝 ComfyUI。PDF、LLM、Edge-TTS、BGM 可獨立使用。
