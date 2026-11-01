"""Opt-in ComfyUI adapter. No model files or untrusted workflow downloads.

API graphs must be reviewed and saved by the user in local-service/workflows.
Only loopback ComfyUI is permitted. No arbitrary filesystem path from clients.
"""
from __future__ import annotations
import base64
import json
from pathlib import Path
import re
import shutil
import subprocess
import uuid
from urllib.parse import quote

try:
    import httpx
except ImportError:  # Python security/unit tests run without third-party packages
    httpx = None

BASE = "http://127.0.0.1:8188"
WORKFLOWS = Path(__file__).resolve().parent / "workflows"
ENGINES = {
    "wan22": {"label": "Wan2.2 · AI 動態影片", "repo": "https://github.com/Wan-Video/Wan2.2", "workflow": "wan22.json", "min_vram": 24},
    "musetalk": {"label": "MuseTalk · 數位人口播", "repo": "https://github.com/TMElyralab/MuseTalk", "workflow": "musetalk.json", "min_vram": 8},
    "sadtalker": {"label": "SadTalker · 照片口播", "repo": "https://github.com/OpenTalker/SadTalker", "workflow": "sadtalker.json", "min_vram": 8}
}
def vram():
    binary = shutil.which("nvidia-smi")
    if not binary: return {"gpu": False, "name": None, "vram_mb": None}
    try:
        p = subprocess.run([binary,"--query-gpu=name,memory.total","--format=csv,noheader,nounits"], capture_output=True,text=True,timeout=3,check=True)
        first = p.stdout.splitlines()[0].split(",")
        return {"gpu": True, "name": first[0].strip(), "vram_mb": int(first[1].strip())}
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return {"gpu": False, "name": None, "vram_mb": None}
def client():
    if httpx is None: raise ValueError("缺少 httpx，請完成本機啟動器套件安裝")
    return httpx.Client(timeout=15,follow_redirects=False,trust_env=False)
def status():
    alive=False
    try:
        with client() as c:
            r=c.get(BASE+"/system_stats")
            alive=(r.status_code==200)
    except Exception:
        pass
    return {
        "comfyui_ready": alive,
        "hardware": vram(),
        "engines": [
            dict(id=key,label=spec["label"],repo=spec["repo"],workflow_ready=(WORKFLOWS/spec["workflow"]).is_file(),min_vram_gb=spec["min_vram"])
            for key,spec in ENGINES.items()
        ]
    }
def graph_for(engine,prompt,image_name=None,audio_name=None):
    if engine not in ENGINES: raise ValueError("不支援的模型")
    path = WORKFLOWS/ENGINES[engine]["workflow"]
    if not path.is_file():
        raise ValueError("尚未安裝 "+engine+" 的已審核 ComfyUI API 工作流。請先參考桌面版 README 與官方模型說明。")
    if path.stat().st_size>2_000_000: raise ValueError("工作流檔案過大")
    obj=json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(obj,dict) or not obj:raise ValueError("工作流必須使用 ComfyUI API 格式，不能是一般畫布工作流")
    for k,v in obj.items():
        if not isinstance(v,dict) or not isinstance(v.get("class_type"),str) or not isinstance(v.get("inputs"),dict):
            raise ValueError("工作流節點格式不正確")
    tokens=json.dumps(obj,ensure_ascii=False)
    if "__PROMPT__" not in tokens:raise ValueError("工作流需在文字輸入節點加入 __PROMPT__ 標記")
    if "__IMAGE__" in tokens and not image_name:raise ValueError("此工作流需要參考圖片")
    if "__AUDIO__" in tokens and not audio_name:raise ValueError("此數位人工作流需要聲音檔")
    def substitute(v):
        if isinstance(v,str):
            return v.replace("__PROMPT__",prompt).replace("__IMAGE__",image_name or "").replace("__AUDIO__",audio_name or "")
        if isinstance(v,dict):return {k:substitute(value) for k,value in v.items()}
        if isinstance(v,list):return [substitute(value) for value in v]
        return v
    return substitute(obj)
def upload_asset(c,data,mime,kind):
    if not isinstance(data,str) or len(data)>18_000_000:raise ValueError("參考素材大小超過上限")
    raw=base64.b64decode(data,validate=True)
    if len(raw)>12_000_000:raise ValueError("素材檔案過大")
    if kind=="image":
        if not raw.startswith(b"\x89PNG\r\n\x1a\n"):raise ValueError("圖片需為 PNG")
        url,filename,type_="/upload/image","reference.png","image/png"
    else:
        if not (raw.startswith(b"ID3") or raw[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")):
            raise ValueError("音訊需為 MP3")
        url,filename,type_="/upload/audio","narration.mp3","audio/mpeg"
    name="pdf_studio_"+uuid.uuid4().hex+"_"+filename
    response=c.post(BASE+url, files={"image" if kind=="image" else "audio":(name,raw,type_)},timeout=45)
    response.raise_for_status()
    result=response.json()
    if not isinstance(result,dict) or not result.get("name"):raise ValueError("ComfyUI 拒絕此參考素材")
    return result["name"]
def queue(body):
    engine=body.get("engine")
    prompt=body.get("prompt","")
    if engine not in ENGINES or not isinstance(prompt,str) or not 1<=len(prompt)<=1200:
        raise ValueError("模型或提示詞不合法")
    image_data=body.get("image_base64")
    audio_data=body.get("audio_base64")
    if image_data is not None and not isinstance(image_data,str):raise ValueError("圖片格式不正確")
    if audio_data is not None and not isinstance(audio_data,str):raise ValueError("音訊格式不正確")
    if (WORKFLOWS/ENGINES[engine]["workflow"]).is_file() is False:
        raise ValueError("需先安裝模型、ComfyUI 與 API 格式工作流（詳見使用說明）")
    with client() as c:
        if c.get(BASE+"/system_stats").status_code!=200:raise ValueError("ComfyUI 未啟動，請先執行本機 ComfyUI")
        image_name=upload_asset(c,image_data,"image/png","image") if image_data else None
        audio_name=upload_asset(c,audio_data,"audio/mpeg","audio") if audio_data else None
        graph=graph_for(engine,prompt,image_name,audio_name)
        response=c.post(BASE+"/prompt",json={"prompt":graph,"client_id":"pdf-studio-"+uuid.uuid4().hex})
        response.raise_for_status()
        obj=response.json()
        prompt_id=obj.get("prompt_id")
        if not isinstance(prompt_id,str) or not re.fullmatch(r"[\w-]{8,100}",prompt_id):raise ValueError("ComfyUI 沒有傳回有效任務代碼")
        return {"job_id":prompt_id}
def lookup(job_id):
    if not isinstance(job_id,str) or not re.fullmatch(r"[\w-]{8,100}",job_id):raise ValueError("任務代碼不合法")
    with client() as c:
        response=c.get(BASE+"/history/"+quote(job_id,safe=""))
        response.raise_for_status()
        data=response.json()
    if job_id not in data:return {"status":"running"}
    job=data[job_id]
    if job.get("status",{}).get("status_str")=="error":return {"status":"failed","error":"ComfyUI 生成失敗，請檢查 ComfyUI 主控台"}
    for output in job.get("outputs",{}).values():
        for category in ("gifs","videos","images"):
            for item in output.get(category,[]):
                filename=item.get("filename","")
                if filename.lower().endswith((".mp4",".webm")):
                    return {"status":"completed","output":True}
    return {"status":"completed","output":False,"error":"工作流完成但未產生 MP4/WebM，請檢查輸出節點"}
def video_bytes(job_id,max_size=100_000_000):
    if lookup(job_id).get("status")!="completed":raise ValueError("影片尚未生成")
    with client() as c:
        response=c.get(BASE+"/history/"+quote(job_id,safe=""))
        response.raise_for_status()
        job=response.json()[job_id]
        for value in job.get("outputs",{}).values():
            for category in ("gifs","videos","images"):
                for item in value.get(category,[]):
                    filename=item.get("filename","")
                    if filename.lower().endswith((".mp4",".webm")):
                        params={"filename":filename,"subfolder":item.get("subfolder",""),"type":item.get("type","output")}
                        with c.stream("GET",BASE+"/view",params=params,timeout=90) as res:
                            res.raise_for_status()
                            data=bytearray()
                            for chunk in res.iter_bytes():
                                data.extend(chunk)
                                if len(data)>max_size:raise ValueError("影片過大，請降低輸出解析度")
                        return bytes(data), ("video/mp4" if filename.lower().endswith(".mp4") else "video/webm")
    raise ValueError("找不到影片輸出")
