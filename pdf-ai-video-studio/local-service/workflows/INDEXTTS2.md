# Index-TTS2 ComfyUI 本機聲線複製工作流

此資料夾的 **tts_index2.json** 與桌面程式一起打包，屬於 **API 格式的節點圖**；來源參考 [Pixelle-Video 官方 tts_index2.json](https://github.com/ATH-MaaS/Pixelle-Video/blob/main/workflows/selfhost/tts_index2.json)，已移除其額外 Text _O 節點，改為直接傳入文字，並改寫音檔輸出前綴。Pixelle-Video 依其 Apache-2.0 授權保留來源標示；模型與 ComfyUI 自訂節點各依原作者授權。

## 在 Windows 安裝並啟用

1. 安裝官方 [ComfyUI Desktop](https://www.comfy.org/download)，啟動本機 API，預設 `127.0.0.1:8188`。
2. 在 ComfyUI 的**自訂節點管理器**尋找包含下列**確切類別名稱**的可信套件：
   - `IndexTTS2BaseNode`：Index-TTS2 文字轉聲音核心節點；
   - `VHS_LoadAudioUpload`：[ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite)；
   - `SaveAudioMP3`：支援 MP3 輸出的 ComfyUI 自訂節點。
3. Index-TTS2 模型權重請從 [IndexTeam/IndexTTS-2](https://huggingface.co/IndexTeam/IndexTTS-2) 等官方來源取得；依實際所選 Index-TTS2 節點版本放進其指定目錄，確認 Python、PyTorch、GPU 驅動的相容性。
4. **先在 ComfyUI 中載入並執行 tts_index2.json**，用自己或已取得聲線使用授權的錄音，確認模型可輸出 MP3。不同節點套件可能使用不同名稱或參數，不相容時先依 ComfyUI 的錯誤訊息處理節點相容性。程式不會假設模型權重存在。
5. 開啟 **PDF 智慧影音製作系統**，選擇「Index-TTS2 自訂聲線」，上傳 **WAV、MP3 或 FLAC** 參考錄音（最多 8 MB），勾選已獲當事人同意，並按「上傳並確認聲線」。
6. 按「試聽自訂聲線」測試；確定生成成功，才能按「產生所有頁面旁白音檔」，為整份 PDF 製作個人聲線的語音。

### 重要限制

- ComfyUI **未連線、節點就緒或試聽失敗時，不能聲稱聲音複製已成功**。目前包含可執行整合程式、工作流範本與檢查，但未附模型、權重或任何人的錄音。
- **只上傳自己或已取得明確授權的人聲**。生成音檔若對外使用，應依適用規範標示為 AI 合成。不要以此冒充第三人。
- 參考錄音會上傳至**使用者本機** ComfyUI 的 input 目錄，生成的音檔會留在 ComfyUI output 目錄。關閉瀏覽器不會自動刪除 ComfyUI 儲存的素材；可手動透過 ComfyUI 清理不再需要的音訊與生成結果。
- **不會**傳至雲端 LLM 或 GitHub；但請勿將 ComfyUI 8188 連接埠暴露於公網。
- 如果聲線近似度不理想，試用 10–30 秒無雜音、無背景音樂、單人、自然的本人聲音錄音。
