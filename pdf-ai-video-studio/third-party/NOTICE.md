# Third-party attribution — Index-TTS2 workflow

Our **`local-service/workflows/tts_index2.json`** is adapted from:

- Project: **Pixelle-Video**
- Repository: https://github.com/ATH-MaaS/Pixelle-Video
- Source: https://github.com/ATH-MaaS/Pixelle-Video/blob/main/workflows/selfhost/tts_index2.json
- License: **Apache License 2.0** (see `Pixelle-Video-APACHE-2.0.txt`).
- Modifications: dropped the optional `Text _O` utility node; connected the narration text directly to `IndexTTS2BaseNode`; changed the output prefix and runtime substitution of reference audio filename.

The project does not bundle Index-TTS2 model weights, ComfyUI nodes, or the original speaker samples. Those components have their own independent licenses and distribution terms. Users must install vetted components from official sources and use only audio they own or have explicit permission to clone.
