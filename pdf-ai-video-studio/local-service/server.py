#!/usr/bin/env python3
"""Private loopback companion; does not receive PDF files or music."""
from __future__ import annotations
import asyncio, base64, json, os, re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parent
ORIGINS={"https://ymguan3-boop.github.io","http://127.0.0.1:8777","http://localhost:8777","http://127.0.0.1:8000","http://localhost:8000"}
VOICES={"zh-TW-YunJheNeural","zh-TW-HsiaoChenNeural","zh-TW-HsiaoYuNeural","zh-CN-YunjianNeural"}
STYLES={
    "audit":"專業審計口吻：審慎、準確，區分事實與風險，不自行推測。",
    "business":"正式成果簡報：口語、自然、重點清晰。",
    "teaching":"教學解說：清楚易懂，不犧牲資訊精確性。",
    "story":"自然敘事：具有吸引力，不虛構事件。"
}
def config():
    d={}
    path=ROOT/".env"
    if path.is_file():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k,v=line.split("=",1)
                if k.strip() in ("LLM_BASE_URL","LLM_MODEL","LLM_API_KEY"):
                    d[k.strip()]=v.strip().strip("'\"")
    for k in ("LLM_BASE_URL","LLM_MODEL","LLM_API_KEY"):
        if k in os.environ:d[k]=os.environ[k]
    return d
def ready(d):return bool(d.get("LLM_BASE_URL") and d.get("LLM_MODEL"))
def valid_url(url):
    x=urlsplit(url)
    if x.username or x.password or x.query or x.fragment:return False
    return (x.scheme=="https" and bool(x.hostname)) or (x.scheme=="http" and x.hostname in {"localhost","127.0.0.1","::1"})
def llm(body):
    import httpx
    settings=config()
    if not ready(settings):raise ValueError("請先設定 local-service/.env 的 LLM_BASE_URL 與 LLM_MODEL")
    base=settings["LLM_BASE_URL"].strip().rstrip("/")
    if not valid_url(base):raise ValueError("LLM 端點限 HTTPS 或本機 localhost HTTP")
    pages=body.get("pages")
    if not isinstance(pages,list) or not 1<=len(pages)<=4:raise ValueError("每次限 1 至 4 頁")
    for p in pages:
        if not isinstance(p,dict) or type(p.get("page")) is not int or not 1<=p["page"]<=60 or not isinstance(p.get("text"),str) or len(p["text"])>2500:
            raise ValueError("頁次或文字格式錯誤")
    secs=body.get("seconds")
    if secs not in [20,40,60,90]:raise ValueError("每頁秒數不支援")
    prompt=(
        "請為以下 PDF 每頁撰寫繁體中文臺灣用語的逐頁朗讀稿，每頁約 "+str(secs)+" 秒。"
        "風格："+STYLES.get(body.get("style"),STYLES["audit"])+
        " 限根據已擷取文字撰寫；禁止憑空虛構圖表內容、數據、法條或結論。"
        " 若圖表資訊缺失應提示人工查核。每頁都要輸出，不能合併或漏頁。"
        " 只回答 JSON，格式為 "+'{"scripts":[{"page":1,"text":"逐頁旁白"}]}'+"。以下是來源資料：\n"+
        json.dumps(pages,ensure_ascii=False)
    )
    headers={"Content-Type":"application/json"}
    if settings.get("LLM_API_KEY"):headers["Authorization"]="Bearer "+settings["LLM_API_KEY"]
    try:
        with httpx.Client(timeout=110,follow_redirects=False,trust_env=False) as client:
            r=client.post(base+"/chat/completions",headers=headers,json={"model":settings["LLM_MODEL"],"messages":[{"role":"user","content":prompt}],"temperature":0.3,"max_tokens":3200})
            r.raise_for_status()
            text=r.json()["choices"][0]["message"]["content"]
        if not isinstance(text,str):raise ValueError("模型未回傳文字")
        text=text.strip()
        if text.startswith(chr(96)*3):
            text=text.split("\n",1)[1].rsplit(chr(96)*3,1)[0].strip()
        if not text.startswith("{"):
            first,last=text.find("{"),text.rfind("}")
            if first<0 or last<=first:raise ValueError("模型未回傳 JSON")
            text=text[first:last+1]
        scripts=json.loads(text).get("scripts")
        expected={p["page"] for p in pages}
        if not isinstance(scripts,list) or {s.get("page") for s in scripts if isinstance(s,dict)}!=expected:
            raise ValueError("模型回傳頁碼不完整")
        for s in scripts:
            if not isinstance(s.get("text"),str) or not s["text"].strip() or len(s["text"])>1800:raise ValueError("旁白為空或過長")
        return {"scripts":scripts}
    except httpx.HTTPStatusError as e:raise ValueError("模型服務 HTTP "+str(e.response.status_code)) from e
    except (httpx.RequestError,KeyError,IndexError,json.JSONDecodeError) as e:raise ValueError("模型連線或回傳 JSON 錯誤") from e
async def tts(text,voice):
    import edge_tts
    data=bytearray();words=[]
    async for c in edge_tts.Communicate(text=text,voice=voice,rate="+0%").stream():
        if c.get("type")=="audio":
            data.extend(c["data"])
            if len(data)>10_000_000:raise ValueError("音訊過長")
        elif c.get("type")=="WordBoundary":
            words.append({"time":round(c.get("offset",0)/10_000_000,3),"duration":round(c.get("duration",0)/10_000_000,3),"text":c.get("text","")})
    if not data:raise ValueError("TTS 沒有回傳音訊")
    return {"audio_base64":base64.b64encode(data).decode("ascii"),"words":words}
class Handler(BaseHTTPRequestHandler):
    server_version="PDFStudioLocal/1.0"
    def allowed(self):
        origin=self.headers.get("Origin")
        return origin is None or origin in ORIGINS
    def send_json(self,code,value):
        data=json.dumps(value,ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length",str(len(data)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        origin=self.headers.get("Origin")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin",origin)
            self.send_header("Vary","Origin")
        self.end_headers()
        self.wfile.write(data)
    def do_OPTIONS(self):
        if not self.allowed():self.send_json(403,{"error":"Origin forbidden"});return
        self.send_response(204)
        origin=self.headers.get("Origin")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin",origin)
            self.send_header("Vary","Origin")
        self.send_header("Access-Control-Allow-Methods","GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers","Content-Type")
        self.send_header("Access-Control-Allow-Private-Network","true")
        self.end_headers()
    def do_GET(self):
        if not self.allowed():self.send_json(403,{"error":"Origin forbidden"})
        elif self.path=="/health":self.send_json(200,{"ok":True,"llm_ready":ready(config()),"tts_ready":True})
        else:self.send_json(404,{"error":"Not found"})
    def do_POST(self):
        if not self.allowed():self.send_json(403,{"error":"Origin forbidden"});return
        if self.path not in ("/api/llm","/api/tts"):self.send_json(404,{"error":"Not found"});return
        if not self.headers.get("Content-Type","").startswith("application/json"):
            self.send_json(415,{"error":"JSON required"});return
        try:
            size=int(self.headers.get("Content-Length","0"))
            if not 0<size<=40000:self.send_json(413,{"error":"Body must be 1-40000 bytes"});return
            body=json.loads(self.rfile.read(size).decode("utf-8"))
            if not isinstance(body,dict):raise ValueError("JSON 格式錯誤")
            if self.path=="/api/llm":out=llm(body)
            else:
                text=body.get("text");voice=body.get("voice")
                if not isinstance(text,str) or not 1<=len(text)<=1800:raise ValueError("旁白限 1-1800 字")
                if voice not in VOICES:raise ValueError("語音型號不合法")
                out=asyncio.run(tts(text,voice))
            self.send_json(200,out)
        except ValueError as e:self.send_json(400,{"error":str(e)})
        except Exception:self.send_json(502,{"error":"模型或語音生成失敗，請檢查本機服務與網路"})
    def log_message(self,fmt,*args):
        print("["+self.log_date_time_string()+"] "+fmt%args)
if __name__=="__main__":
    print("PDF AI Video Studio · loopback 127.0.0.1:8765")
    print("請在瀏覽器開啟 https://ymguan3-boop.github.io/original-tools/pdf-ai-video-studio/")
    print("金鑰只從本機 .env 讀取；勿將 8765 埠轉發到公開網路。")
    try:ThreadingHTTPServer(("127.0.0.1",8765),Handler).serve_forever()
    except KeyboardInterrupt:print("Stopped.")
