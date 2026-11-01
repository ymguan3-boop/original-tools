"""Local Index-TTS2 voice-cloning adapter (ComfyUI, no cloud API).

Requires explicit recording rights and a reviewed IndexTTS2 ComfyUI workflow.
Audio is uploaded ONLY to loopback ComfyUI, which may persist it in its input/
and output/ directories. Nothing is sent to GitHub or the browser's LLM.
"""
from __future__ import annotations

import base64
import json
from pathlib import Path
import re
import secrets
import threading
import time

try:
    import httpx
except ImportError:
    httpx = None

BASE = "http://127.0.0.1:8188"
WORKFLOW = Path(__file__).resolve().parent / "workflows" / "tts_index2.json"
REQUIRED_NODES = {"IndexTTS2BaseNode", "VHS_LoadAudioUpload", "SaveAudioMP3"}
MAX_REFERENCE_BYTES = 8 * 1024 * 1024
MAX_OUTPUT_BYTES = 24 * 1024 * 1024
TOKEN_TTL = 3600
_lock = threading.Lock()
_references = {}
_jobs = {}


def _client(timeout=8):
    if httpx is None:
        raise ValueError("缺少 httpx；請用桌面版 EXE 完成必要套件安裝")
    return httpx.Client(timeout=timeout, follow_redirects=False, trust_env=False)


def _cleanup():
    now = time.monotonic()
    for collection in (_references, _jobs):
        for key, value in list(collection.items()):
            if now - value["created"] > TOKEN_TTL:
                collection.pop(key, None)


def audio_type(content: bytes) -> tuple[str, str]:
    if content.startswith(b"RIFF") and content[8:12] == b"WAVE":
        return "audio/wav", "wav"
    if content.startswith(b"fLaC"):
        return "audio/flac", "flac"
    if content.startswith(b"ID3") or (len(content) > 2 and content[0] == 255 and content[1] & 0xE0 == 0xE0):
        return "audio/mpeg", "mp3"
    raise ValueError("參考錄音只支援 WAV、MP3、FLAC，請勿上傳其他格式")


def workflow():
    if not WORKFLOW.is_file():
        raise ValueError("ZIP 缺少 Index-TTS2 工作流，請重新下載完整版")
    graph = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    if not isinstance(graph, dict) or not graph or len(graph) > 16:
        raise ValueError("Index-TTS2 工作流格式錯誤")
    actual = set()
    for node in graph.values():
        if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
            raise ValueError("Index-TTS2 節點格式錯誤")
        kind = node.get("class_type")
        if kind not in REQUIRED_NODES:
            raise ValueError("工作流包含非允許的節點：" + str(kind))
        actual.add(kind)
    if actual != REQUIRED_NODES:
        raise ValueError("Index-TTS2 工作流節點不完整")
    return graph


def status():
    details = {
        "comfyui_ready": False,
        "workflow_bundled": WORKFLOW.is_file(),
        "nodes_ready": False,
        "missing_nodes": sorted(REQUIRED_NODES),
        "model_verified": False,
        "model_note": "節點存在不代表模型權重已下載；請先完成試聽生成",
        "node_source": "https://github.com/ATH-MaaS/Pixelle-Video/blob/main/workflows/selfhost/tts_index2.json",
        "upstream": "https://github.com/index-tts/index-tts",
    }
    if httpx is None:
        return details
    try:
        with _client() as client:
            check = client.get(BASE + "/system_stats")
            if check.status_code != 200:
                return details
            details["comfyui_ready"] = True
            nodes = client.get(BASE + "/object_info")
            if nodes.status_code == 200:
                registry = nodes.json()
                if isinstance(registry, dict):
                    details["missing_nodes"] = sorted(REQUIRED_NODES - set(registry))
                    details["nodes_ready"] = not details["missing_nodes"]
    except (httpx.HTTPError, ValueError, TypeError):
        pass
    return details


def upload_reference(encoded: str, permitted: bool) -> dict:
    if permitted is not True:
        raise ValueError("請先確認已獲參考錄音本人授權，才能上傳與複製聲音")
    if not isinstance(encoded, str) or not 4 <= len(encoded) <= 11_200_000:
        raise ValueError("錄音太大或為空白，最多 8 MB")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error) as e:
        raise ValueError("錄音編碼不正確") from e
    if not 1024 <= len(raw) <= MAX_REFERENCE_BYTES:
        raise ValueError("請上傳 1 KB 至 8 MB 的錄音樣本")
    mime, suffix = audio_type(raw)
    check = status()
    if not check["comfyui_ready"]:
        raise ValueError("ComfyUI 尚未啟動，請開啟 ComfyUI 並確認 8188 埠")
    if not check["nodes_ready"]:
        raise ValueError("ComfyUI 缺少 Index-TTS2 節點：" + "、".join(check["missing_nodes"]))
    name = "pdf_voice_" + secrets.token_hex(12) + "." + suffix
    with _client(60) as client:
        response = client.post(BASE + "/upload/audio",
                               files={"audio": (name, raw, mime)}, timeout=60)
        if response.status_code in (404, 405):
            raise ValueError("此 ComfyUI 版本沒有 /upload/audio，請更新 ComfyUI 或使用支援音訊上傳的版本")
        response.raise_for_status()
        obj = response.json()
        uploaded = obj.get("name") if isinstance(obj, dict) else None
        if not isinstance(uploaded, str) or not uploaded:
            raise ValueError("ComfyUI 沒有確認錄音檔案名稱")
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,150}", uploaded):
            raise ValueError("ComfyUI 回傳的檔名格式不合法")
    token = secrets.token_urlsafe(24)
    with _lock:
        _cleanup()
        _references[token] = {"created": time.monotonic(), "name": uploaded}
    # Do not return any local filesystem path or the uploaded audio bytes.
    return {"reference_token": token, "ready": True, "message": "已上傳到本機 ComfyUI；可先試聽聲線"}


def render(text: str, token: str, permitted: bool) -> dict:
    if permitted is not True:
        raise ValueError("尚未確認錄音所有人同意使用此聲線")
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 600:
        raise ValueError("Index-TTS2 每次限 1–600 字；請縮短該頁旁白或分段")
    if not isinstance(token, str):
        raise ValueError("無效的錄音憑證")
    with _lock:
        _cleanup()
        record = _references.get(token)
    if not record:
        raise ValueError("參考錄音不存在或已逾期，請重新上傳")
    graph = workflow()
    # Fixed, audited graph; only natural-language text and uploaded filename
    # are substituted. Never accept arbitrary node graphs from the browser.
    nodes = list(graph.values())
    tts_node = next(n for n in nodes if n["class_type"] == "IndexTTS2BaseNode")
    load_node = next(n for n in nodes if n["class_type"] == "VHS_LoadAudioUpload")
    tts_node["inputs"]["text"] = text.strip()
    load_node["inputs"]["audio"] = record["name"]
    with _client(30) as client:
        response = client.post(BASE + "/prompt", json={"prompt": graph, "client_id": "pdf-voice-" + secrets.token_hex(8)})
        if response.status_code == 400:
            raise ValueError("ComfyUI 工作流無法驗證，請安裝對應的 Index-TTS2、VHS 與音訊輸出節點；詳見 ComfyUI 錯誤紀錄")
        response.raise_for_status()
        obj = response.json()
    task_id = obj.get("prompt_id") if isinstance(obj, dict) else None
    if not isinstance(task_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,100}", task_id):
        raise ValueError("ComfyUI 未提供有效的生成任務代碼")
    with _lock:
        _cleanup()
        _jobs[task_id] = {"created": time.monotonic()}
    return {"job_id": task_id, "status": "queued"}


def _job(job_id: str):
    if not isinstance(job_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,100}", job_id):
        raise ValueError("任務代碼格式不正確")
    with _lock:
        _cleanup()
        if job_id not in _jobs:
            raise ValueError("找不到本程式送出的任務，或任務已逾期")


def history(job_id: str):
    _job(job_id)
    with _client(30) as client:
        res = client.get(BASE + "/history/" + job_id)
        res.raise_for_status()
        result = res.json()
    entry = result.get(job_id) if isinstance(result, dict) else None
    if not entry:
        return None
    return entry


def audio_descriptor(entry):
    if not isinstance(entry, dict):
        return None
    for node in (entry.get("outputs") or {}).values():
        if not isinstance(node, dict):
            continue
        for collection in ("audio", "audios", "files"):
            items = node.get(collection, [])
            if not isinstance(items, list):
                continue
            for item in items:
                if isinstance(item, dict) and str(item.get("filename", "")).lower().endswith((".mp3", ".wav", ".flac")):
                    return item
    return None


def job_status(job_id):
    entry = history(job_id)
    if entry is None:
        return {"status": "running"}
    state = entry.get("status", {})
    if state.get("status_str") in ("error", "execution_error"):
        return {"status": "failed", "error": "Index-TTS2 推論失敗，請檢查 ComfyUI 主控台與模型權重"}
    output = audio_descriptor(entry)
    if output:
        return {"status": "completed", "has_audio": True}
    return {"status": "failed", "error": "工作流完成但沒有提供音訊輸出；請確認 SaveAudioMP3 節點"}


def generated_audio(job_id):
    entry = history(job_id)
    if entry is None:
        raise ValueError("語音生成任務尚未完成")
    item = audio_descriptor(entry)
    if not item:
        raise ValueError("Index-TTS2 尚未生成可下載的音檔")
    name = str(item["filename"])
    sub = str(item.get("subfolder", ""))
    kind = str(item.get("type", "output"))
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,180}", name) or not re.fullmatch(r"[A-Za-z0-9_./-]{0,150}", sub):
        raise ValueError("ComfyUI 輸出檔名不合法")
    if kind not in ("output", "temp"):
        raise ValueError("ComfyUI 音訊來源不支援")
    with _client(120) as client:
        with client.stream("GET", BASE + "/view", params={"filename": name, "subfolder": sub, "type": kind}, timeout=120) as res:
            res.raise_for_status()
            data = bytearray()
            for part in res.iter_bytes():
                data.extend(part)
                if len(data) > MAX_OUTPUT_BYTES:
                    raise ValueError("生成音檔超過 24 MB，請減少文字長度")
    mime, _ = audio_type(bytes(data))
    return bytes(data), mime
