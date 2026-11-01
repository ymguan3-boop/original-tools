/* PDF AI Video Studio Windows desktop HTML frontend. Served only from 127.0.0.1; secrets remain in local .env. */
"use strict";
(function () {
  const $ = (id) => document.getElementById(id);
  const LOCAL = "http://127.0.0.1:8765";
  const ui = {
    file:$("pdfFile"),info:$("fileInfo"),title:$("movieTitle"),mode:$("scriptMode"),
    aiOptions:$("aiOptions"),style:$("narrativeStyle"),seconds:$("targetSeconds"),
    scripts:$("generateScripts"),audio:$("generateAudio"),voice:$("voiceSelect"),
    music:$("enableBgm"),bgm:$("bgmFile"),volume:$("bgmVolume"),volumeLabel:$("volumeLabel"),
    template:$("templateSelect"),aspect:$("aspectSelect"),preview:$("videoCanvas"),
    scenes:$("sceneList"),count:$("sceneCount"),editor:$("scriptEditor"),
    editorTitle:$("editorTitle"),audioState:$("audioState"),meta:$("pageMeta"),
    play:$("playPreview"),stop:$("stopPreview"),export:$("exportVideo"),
    clock:$("clock"),log:$("log"),health:$("serverStatus"),
    restore:$("restoreText"),download:$("downloadScript"),
    engine:$("aiEngine"),engineCheck:$("engineCheck"),engineInfo:$("engineDetails"),
    pythonStatus:$("pythonStatus"),comfyStatus:$("comfyStatus"),
    clipPrompt:$("aiPrompt"),reference:$("referenceImage"),clipGenerate:$("generateAIClip"),
    clipStatus:$("engineResult")
  };
  const state = {
    doc:null,pages:[],selected:0,cache:new Map(),title:"",bgmURL:null,
    service:false,busy:false,playing:false,session:0,playingPage:0,
    voice:null,music:null,ctx:null,recorder:null,stream:null,raf:0,
    clockOffset:0,sceneTimer:null,engineStatus:null,clipBusy:false
  };
  const ctx = ui.preview.getContext("2d",{alpha:false});
  function say(msg,bad) { ui.log.textContent=(bad?"⚠ ":"✓ ")+msg; ui.log.style.borderColor=bad?"#ffb273":"#5db9f9"; }
  const clean = (s) => String(s||"").replace(/\s+/g," ").trim();
  const estimated = (s) => Math.max(1.5,clean(s).length/3.7);
  const two = (x) => String(Math.floor(Math.max(0,x))).padStart(2,"0");
  const fmt = (s) => two(s/60)+":"+two(s%60);
  function setBusy(on) {
    state.busy=on;
    [ui.file,ui.scripts,ui.audio,ui.mode,ui.play,ui.export,ui.download].forEach(e => e.disabled=on);
    updateUI();
  }
  function revokeAudio(page) {
    if(page.audioURL){URL.revokeObjectURL(page.audioURL);page.audioURL=null;}
    page.audioText=null;page.words=[];page.duration=estimated(page.script);
  }
  function changeAllAudio() {
    for(const p of state.pages) revokeAudio(p);
    updateUI();
  }
  function hasAudio() { return state.pages.length>0 && state.pages.every(p=>!clean(p.script)||!!p.audioURL); }
  function updateUI() {
    const ready=state.pages.length>0&&!state.busy&&!state.playing;
    ui.aiOptions.hidden=ui.mode.value!=="ai";
    ui.scripts.disabled=!ready||!state.service||ui.mode.value!=="ai";
    ui.audio.disabled=!ready||!state.service||!state.pages.some(p=>clean(p.script));
    ui.editor.disabled=!ready;
    ui.restore.disabled=!ready;
    ui.download.disabled=!ready;
    ui.play.disabled=!ready||!hasAudio();
    ui.export.disabled=!ready||!hasAudio()||!window.MediaRecorder||!ui.preview.captureStream;
    ui.stop.disabled=!state.playing;
    ui.clipGenerate.disabled=!ready||!state.service||!state.engineStatus?.comfyui_ready||!ui.engine.value||!state.engineStatus.engines.some(e=>e.id===ui.engine.value&&e.workflow_ready)||state.clipBusy;
    ui.aspect.disabled=state.playing;ui.template.disabled=state.playing;
    ui.bgm.disabled=!ui.music.checked;
    ui.volume.disabled=!ui.music.checked;
    ui.info.textContent=state.pages.length?state.title+" · "+state.pages.length+" 頁 · "+state.pages.reduce((n,p)=>n+p.underlines.length,0)+" 個底線候選標記":"尚未選擇 PDF";
    ui.count.textContent=state.pages.length+" 頁";
    const p=state.pages[state.selected];
    ui.audioState.textContent=p?(p.audioURL?"✓ 音檔已產生":"需要重新配音"):"尚無音檔";
    ui.meta.textContent=p?"第 "+(state.selected+1)+" 頁｜偵測底線 "+p.underlines.length+" 處｜預估 "+Math.round(p.duration)+" 秒｜AI 文字須人工校核":"請先匯入 PDF";
    updateTime();
  }
  function updateTime(){
    const all=state.pages.reduce((n,p)=>n+p.duration,0);
    const current=state.playing?(state.clockOffset+(state.voice&&isFinite(state.voice.currentTime)?state.voice.currentTime:0)):0;
    ui.clock.textContent=fmt(current)+" / "+fmt(all);
  }
  async function api(path,payload) {
    const control=new AbortController(),timer=setTimeout(()=>control.abort(),120000);
    try{
      const r=await fetch(LOCAL+path,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload),signal:control.signal,cache:"no-store"
      });
      let d;
      try {d=await r.json();} catch (_){throw new Error("本機服務回應不是 JSON");}
      if(!r.ok) throw new Error(d.error||("HTTP "+r.status));
      return d;
    } finally {clearTimeout(timer);}
  }
  async function checkHealth(){
    const control=new AbortController(),timer=setTimeout(()=>control.abort(),3000);
    try{
      const r=await fetch(LOCAL+"/health",{signal:control.signal,cache:"no-store"});
      const d=await r.json();
      state.service=!!r.ok;
      ui.health.textContent="本機服務已連線"+(d.llm_ready?" · LLM 可用":" · 未設定 LLM");
      ui.health.className="status ok";
      ui.scripts.dataset.llm=d.llm_ready?"1":"0";
      if(!d.llm_ready)ui.health.title="請設定 local-service/.env 中的 LLM_BASE_URL、LLM_MODEL 與必要的 LLM_API_KEY";
    }catch(_){
      state.service=false;ui.health.textContent="本機 AI／TTS 未連線";ui.health.className="status off";
      ui.scripts.dataset.llm="0";
    } finally {clearTimeout(timer);updateUI();}
  }
  async function underlineShapes(page){
    // Adapted from the original PDF underline approach: small filled PDF rectangles.
    const matches=[];
    try{
      const ops=await page.getOperatorList(),list=ops.fnArray,args=ops.argsArray,O=pdfjsLib.OPS;
      const items=(await page.getTextContent()).items.filter(x=>clean(x.str));
      for(let i=0;i<list.length;i++){
        let r=null;
        if(list[i]===O.rectangle)r=args[i];
        else if(list[i]===O.constructPath && Array.isArray(args[i][0]) && args[i][0].includes(O.rectangle))r=args[i][1];
        if(!r||r.length<4)continue;
        const [x,y,w,h]=r;
        if(![x,y,w,h].every(Number.isFinite)||w<=5||h<0||h>=3.5)continue;
        const covered=items.filter(it=>{
          const ix=it.transform[4],iy=it.transform[5],iw=it.width||0,ih=it.height||12;
          return ix<x+w && ix+iw>x && y>=iy-ih*0.9-3 && y<=iy+ih*.4+3;
        });
        if(covered.length)matches.push({x,y,w,h,text:clean(covered.map(it=>it.str).join(" "))});
      }
    }catch(e){console.warn("underline detection",e);}
    return matches.slice(0,150);
  }
  async function loadPDF(file){
    if(!file||state.busy)return;
    if(file.size>30*1024*1024){say("PDF 大於 30 MB；請先分割後匯入。",true);return;}
    if(typeof pdfjsLib==="undefined"){say("PDF.js 無法載入；請確認原始 PDF 工具的 lib 目錄存在。",true);return;}
    if(state.playing)stopPlayback();
    setBusy(true);say("正在解析 PDF 與底線位置…");
    try{
      if(state.doc){await state.doc.destroy().catch(()=>{});}
      for(const p of state.pages){revokeAudio(p);if(p.clipURL)URL.revokeObjectURL(p.clipURL);}
      state.cache.clear();
      pdfjsLib.GlobalWorkerOptions.workerSrc="../pdf-voice-video/lib/pdf.worker.min.js";
      const doc=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false}).promise;
      if(doc.numPages>60){await doc.destroy();throw new Error("最多支援 60 頁，請分冊輸入。");}
      state.doc=doc;state.pages=[];state.selected=0;state.title=file.name.replace(/\.pdf$/i,"");
      ui.title.value=state.title;
      for(let i=1;i<=doc.numPages;i++){
        const page=await doc.getPage(i);
        const content=await page.getTextContent();
        const text=clean(content.items.map(x=>x.str).join(" "));
        const underlines=await underlineShapes(page);
        const script=text.slice(0,260);
        state.pages.push({index:i,text,script,underlines,audioURL:null,audioText:null,words:[],duration:estimated(script),clipURL:null,clipEl:null});
        if(i%5===0)say("已解析 "+i+" / "+doc.numPages+" 頁…");
      }
      if(ui.mode.value==="underline")applyUnderlineMode();
      drawTimeline();
      await chooseScene(0);
      say("PDF 已匯入。可使用 AI 產生逐頁旁白，或直接修改下方逐頁文字。");
    }catch(e){say("PDF 解析失敗："+e.message,true);}
    finally{setBusy(false);}
  }
  function applyUnderlineMode(){
    for(const p of state.pages){
      p.script=p.underlines.length?clean(p.underlines.map(x=>x.text).join("。")):p.text.slice(0,260);
      revokeAudio(p);
    }
  }
  function applyManualMode(){
    for(const p of state.pages){p.script=p.text.slice(0,260);revokeAudio(p);}
  }
  async function getPageImage(i){
    if(state.cache.has(i))return state.cache.get(i);
    const page=await state.doc.getPage(i+1),unit=page.getViewport({scale:1});
    const scale=Math.min(2,1400/Math.max(unit.width,unit.height));
    const viewport=page.getViewport({scale});
    const c=document.createElement("canvas");c.width=Math.max(1,Math.round(viewport.width));c.height=Math.max(1,Math.round(viewport.height));
    await page.render({canvasContext:c.getContext("2d"),viewport,background:"#fff"}).promise;
    const out={canvas:c,viewport};
    state.cache.set(i,out);
    if(state.cache.size>3)state.cache.delete(state.cache.keys().next().value);
    return out;
  }
  function drawTimeline(){
    ui.scenes.replaceChildren();
    for(let i=0;i<state.pages.length;i++){
      const p=state.pages[i],b=document.createElement("button");
      b.type="button";b.className="scene"+(i===state.selected?" active":"");
      const left=document.createElement("span");left.className="scene-name";
      const strong=document.createElement("b");strong.textContent="第 "+p.index+" 頁";
      const summary=document.createElement("small");summary.textContent=" · "+(clean(p.script).slice(0,18)||"無文案");
      left.append(strong,summary);
      const right=document.createElement("small");right.textContent=Math.ceil(p.duration)+"s"+(p.audioURL?" ♫":"")+(p.clipURL?" 🎬":"");
      b.append(left,right);b.addEventListener("click",()=>chooseScene(i));ui.scenes.appendChild(b);
    }
    updateUI();
  }
  async function chooseScene(i){
    if(state.playing||!state.pages[i])return;
    state.selected=i;ui.editorTitle.textContent="第 "+(i+1)+" 頁旁白編輯";
    ui.editor.value=state.pages[i].script;
    drawTimeline();
    try{await getPageImage(i);drawScene(i,0);}catch(e){say("無法渲染頁面："+e.message,true);}
  }
  function dimensions(){
    const a=ui.aspect.value,c=ui.preview;
    const size=a==="9:16"?[720,1280]:(a==="1:1"?[960,960]:[1280,720]);
    // NEVER resize an active captured canvas: MediaRecorder tracks can freeze.
    if(c.width!==size[0] || c.height!==size[1]){c.width=size[0];c.height=size[1];}
  }
  function background(){
    const w=ui.preview.width,h=ui.preview.height,t=ui.template.value;
    if(t==="minimal"){ctx.fillStyle="#f5f6f9";ctx.fillRect(0,0,w,h);return;}
    const g=ctx.createLinearGradient(0,0,w,h);
    if(t==="cinematic"){g.addColorStop(0,"#070d1e");g.addColorStop(1,"#223358");}
    else{g.addColorStop(0,"#0e2541");g.addColorStop(1,"#142e48");}
    ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    ctx.strokeStyle=t==="cinematic"?"#edbd6742":"#60c6fa22";ctx.lineWidth=2;
    for(let x=-h;x<w+h;x+=85){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+h,h);ctx.stroke();}
  }
  function wrapLine(s,maxPx,font){
    ctx.font=font;
    let lines=[],chunk="";
    for(const ch of [...s]){
      if(ctx.measureText(chunk+ch).width>maxPx&&chunk){lines.push(chunk);chunk=ch;}
      else chunk+=ch;
    }
    if(chunk)lines.push(chunk);
    return lines.length?lines:[""];
  }
  function drawScene(i,progress){
    dimensions();const w=ui.preview.width,h=ui.preview.height,p=state.pages[i];
    background();if(!p){ctx.fillStyle="#9ecbe8";ctx.textAlign="center";ctx.font="bold 28px sans-serif";ctx.fillText("匯入 PDF，開始製作影片",w/2,h/2);return;}
    const t=ui.template.value,ink=t==="minimal"?"#1e3452":"#f4f8ff",accent=t==="minimal"?"#2276bb":"#ffd56c";
    const portrait=w<h,header=portrait?98:70,footer=portrait?250:140;
    ctx.fillStyle=ink;ctx.textAlign="left";ctx.font="bold "+(portrait?25:28)+"px sans-serif";
    const heading=clean(ui.title.value)||state.title||"PDF 智慧影音影片";
    ctx.fillText(heading.length>(portrait?16:32)?heading.slice(0,portrait?16:32)+"…":heading,30,header/2+9);
    ctx.textAlign="right";ctx.font="17px sans-serif";ctx.fillText((i+1)+" / "+state.pages.length,w-32,header/2+7);
    const img=state.cache.get(i);
    if(img){
      const padding=portrait?36:60,aw=w-2*padding,ah=h-header-footer-15;
      const ratio=Math.min(aw/img.canvas.width,ah/img.canvas.height);
      const dw=img.canvas.width*ratio,dh=img.canvas.height*ratio,x=(w-dw)/2,y=header+(ah-dh)/2+8;
      ctx.save();ctx.shadowColor="#0008";ctx.shadowBlur=18;ctx.fillStyle="#fff";ctx.fillRect(x,y,dw,dh);ctx.restore();
      ctx.drawImage(img.canvas,x,y,dw,dh);
      if(ui.mode.value==="underline"&&p.underlines.length){
        ctx.save();ctx.fillStyle="rgba(255,199,25,.42)";
        const max=Math.max(0,Math.floor(progress*p.underlines.length));
        p.underlines.slice(0,max).forEach(r=>{
          const z=img.viewport.convertToViewportRectangle([r.x,r.y,r.x+r.w,r.y+r.h]);
          const rx=Math.min(z[0],z[2]),ry=Math.min(z[1],z[3]);
          const rw=Math.abs(z[2]-z[0]),rh=Math.abs(z[3]-z[1]);
          ctx.fillRect(x+rx*ratio,y+(ry-12)*ratio,rw*ratio,(rh+20)*ratio);
        });ctx.restore();
      }
    }
    // AI media is always labelled as a generated illustration, never as PDF evidence.
    if(p.clipEl && p.clipEl.readyState>=2){
      const clip=p.clipEl, cw=Math.round(w*(portrait?.56:.29)), ch=Math.round(cw*9/16);
      const x=w-cw-23, y=header+23;
      const safeH=Math.min(ch,Math.max(64,h-header-footer-35));
      ctx.save();ctx.fillStyle="rgba(5,10,20,.93)";ctx.fillRect(x-6,y-6,cw+12,safeH+40);
      try{ctx.drawImage(clip,x,y,cw,safeH);}catch(_){}
      ctx.fillStyle="rgba(4,11,21,.9)";ctx.fillRect(x,y+safeH-1,cw,28);
      ctx.fillStyle="#ffd56c";ctx.font="bold 16px sans-serif";ctx.textAlign="center";
      ctx.fillText("AI 生成示意 · 非原始證據",x+cw/2,y+safeH+20);
      ctx.restore();
    }
    const text=clean(p.script);
    if(text){
      const area=w-50,fs=portrait?26:23,font="600 "+fs+"px sans-serif";
      const lines=wrapLine(text,area-35,font),idx=Math.min(lines.length-1,Math.floor(progress*lines.length));
      const line=lines[idx]||"",subH=portrait?156:85,y=h-subH-20;
      ctx.fillStyle=t==="minimal"?"rgba(12,30,54,.9)":"rgba(5,11,23,.89)";
      ctx.fillRect(25,y,area,subH);
      ctx.textAlign="center";ctx.font=font;ctx.fillStyle="#edf4ff";
      const chunks=wrapLine(line,area-35,font).slice(0,2);
      chunks.forEach((part,j)=>ctx.fillText(part,w/2,y+subH/2+(j-(chunks.length-1)/2)*37+8));
      ctx.fillStyle=accent;ctx.fillRect(25,y+subH-4,Math.max(0,area*Math.min(1,progress)),4);
    }
    if(progress<.08&&state.playing){
      ctx.fillStyle="rgba(0,0,0,"+(1-progress/.08)+")";ctx.fillRect(0,0,w,h);
    }
  }
  async function generateScripts(){
    if(!state.pages.length||state.busy)return;
    if(!state.service){say("請先啟動本機服務。",true);return;}
    if(ui.scripts.dataset.llm!=="1"){say("尚未設定本機 LLM 服務的模型或端點。",true);return;}
    setBusy(true);say("AI 正依 PDF 文字產生逐頁文案…");
    try{
      for(let start=0;start<state.pages.length;start+=4){
        const chunk=state.pages.slice(start,start+4).map(p=>({page:p.index,text:p.text.slice(0,2400)}));
        const result=await api("/api/llm",{pages:chunk,style:ui.style.value,seconds:Number(ui.seconds.value)});
        if(!Array.isArray(result.scripts))throw new Error("LLM 回傳格式不正確");
        const found=new Map(result.scripts.map(x=>[Number(x.page),clean(x.text)]));
        for(const p of state.pages.slice(start,start+4)){
          const text=found.get(p.index);if(!text)throw new Error("缺少第 "+p.index+" 頁旁白");
          p.script=text;revokeAudio(p);
        }
        say("AI 已撰寫 "+Math.min(start+4,state.pages.length)+" / "+state.pages.length+" 頁；請核對數字與法令。");
      }
      drawTimeline();await chooseScene(state.selected);
      say("AI 逐頁旁白完成，請先核對各頁，再產生語音。");
    }catch(e){say("AI 產生中止："+e.message,true);drawTimeline();}
    finally{setBusy(false);}
  }
  function base64ToBlob(base64,type){
    const bin=atob(base64),arr=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
    return new Blob([arr],{type});
  }
  function durationOf(url,fallback){
    return new Promise(resolve=>{
      const a=new Audio(),timer=setTimeout(()=>{a.removeAttribute("src");resolve(fallback);},9000);
      a.preload="metadata";a.onloadedmetadata=()=>{clearTimeout(timer);resolve(isFinite(a.duration)?a.duration:fallback);};
      a.onerror=()=>{clearTimeout(timer);resolve(fallback);};a.src=url;
    });
  }
  async function generateAudio(){
    if(!state.pages.length||state.busy||!state.service)return;
    setBusy(true);say("正在用 Edge-TTS 逐頁產生語音…");
    try{
      for(let i=0;i<state.pages.length;i++){
        const p=state.pages[i],text=clean(p.script);revokeAudio(p);
        if(!text){p.duration=1.2;continue;}
        if(text.length>1800)throw new Error("第 "+p.index+" 頁旁白超過 1800 字，請縮短後再配音。");
        const d=await api("/api/tts",{text,voice:ui.voice.value});
        if(!d.audio_base64)throw new Error("第 "+p.index+" 頁無音訊");
        p.audioURL=URL.createObjectURL(base64ToBlob(d.audio_base64,"audio/mpeg"));
        p.audioText=text;p.words=Array.isArray(d.words)?d.words:[];
        p.duration=await durationOf(p.audioURL,estimated(text));
        say("已產生語音 "+(i+1)+" / "+state.pages.length+" 頁");
      }
      say("所有旁白音檔已完成，可直接播放或錄製，不需要分享螢幕音訊。");
      drawTimeline();await chooseScene(state.selected);
    }catch(e){say("配音中止："+e.message,true);drawTimeline();}
    finally{setBusy(false);}
  }
  function audioSession(){
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC)throw new Error("瀏覽器不支援 AudioContext");
    const context=new AC(),destination=context.createMediaStreamDestination();
    const voice=new Audio();voice.preload="auto";
    const vs=context.createMediaElementSource(voice),vg=context.createGain();
    vs.connect(vg);vg.connect(destination);vg.connect(context.destination);
    let music=null,mg=null;
    if(ui.music.checked&&state.bgmURL){
      music=new Audio(state.bgmURL);music.loop=true;
      const bs=context.createMediaElementSource(music);mg=context.createGain();
      bs.connect(mg);mg.connect(destination);mg.connect(context.destination);
      mg.gain.value=0;
    }
    state.voice=voice;state.music=music;state.ctx=context;
    return {context,destination,mg,vg};
  }
  async function startPlayback(record){
    if(state.playing||state.busy||!hasAudio()){say("請先為所有有文案的頁面產生旁白音檔。",true);return;}
    let session;
    try{
      session=audioSession();
      await session.context.resume();
      state.playing=true;state.session++;state.playingPage=0;state.clockOffset=0;
      if(record){
        const videoStream=ui.preview.captureStream(30);
        const stream=new MediaStream([...videoStream.getVideoTracks(),...session.destination.stream.getAudioTracks()]);
        state.stream=stream;
        const mime=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"]
          .find(x=>MediaRecorder.isTypeSupported(x))||"";
        const opts=mime?{mimeType:mime,videoBitsPerSecond:5500000}:undefined;
        const mr=new MediaRecorder(stream,opts),chunks=[];
        mr.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
        mr.onstop=()=>{
          if(!chunks.length){say("影片沒有成功錄製。",true);return;}
          download(new Blob(chunks,{type:mime||"video/webm"}),"PDF-AI-Video-Studio.webm");
          say("影片已完成下載。影片含旁白、字幕及選用的背景音樂。");
        };
        state.recorder=mr;mr.start(1000);
      }
      ui.stop.disabled=false;ui.play.disabled=true;ui.export.disabled=true;ui.editor.disabled=true;
      ui.aspect.disabled=true;ui.template.disabled=true;
      if(session.mg&&state.music){
        const target=Number(ui.volume.value)/100;
        session.mg.gain.setValueAtTime(0,session.context.currentTime);
        session.mg.gain.linearRampToValueAtTime(target*.25,session.context.currentTime+.8);
        state.music.play().catch(()=>say("背景音樂無法播放，影片仍會繼續。",true));
      }
      say(record?"影片錄製中，請勿關閉此分頁…":"預覽播放中…");
      const currentSession=state.session;
      runFrame(currentSession,session.mg);
      await playScene(0,currentSession,session.mg);
    }catch(e){say("播放或錄影失敗："+e.message,true);stopPlayback();}
  }
  async function playScene(i,sessionId,mg){
    if(!state.playing||sessionId!==state.session)return;
    if(i>=state.pages.length){stopPlayback();return;}
    if(i>0 && state.pages[i-1]?.clipEl){try{state.pages[i-1].clipEl.pause();}catch(_){}}
    state.playingPage=i;state.selected=i;
    ui.editorTitle.textContent="第 "+(i+1)+" 頁旁白編輯";ui.editor.value=state.pages[i].script;
    ui.audioState.textContent="播放中";
    drawTimeline();
    await getPageImage(i);
    if(!state.playing||sessionId!==state.session)return;
    const page=state.pages[i];
    drawScene(i,0);
    if(page.clipEl){
      try{page.clipEl.currentTime=0;await page.clipEl.play();}catch(e){console.warn("AI clip preview",e);}
    }
    if(mg){
      const target=Number(ui.volume.value)/100,now=state.ctx.currentTime;
      mg.gain.cancelScheduledValues(now);
      const level=page.audioURL?target*.18:target*.5;
      mg.gain.setTargetAtTime(level,now,.3);
      // Fade background music out before the final scene ends.
      if(i===state.pages.length-1){
        const fadeAt=now+Math.max(.6,page.duration-1.7);
        mg.gain.setValueAtTime(level,fadeAt);
        mg.gain.linearRampToValueAtTime(0,fadeAt+1.5);
      }
    }
    if(page.audioURL){
      state.voice.onended=()=>{if(state.playing&&sessionId===state.session){state.clockOffset+=page.duration;playScene(i+1,sessionId,mg).catch(err=>{say(err.message,true);stopPlayback();});}};
      state.voice.src=page.audioURL;
      state.voice.currentTime=0;
      try{await state.voice.play();}catch(e){throw new Error("無法播放語音，請在桌面 Chrome/Edge 再試："+e.message);}
    }else{
      state.sceneTimer=setTimeout(()=>{state.clockOffset+=page.duration;playScene(i+1,sessionId,mg);},page.duration*1000);
    }
  }
  function runFrame(sessionId,mg){
    function frame(){
      if(!state.playing||state.session!==sessionId)return;
      const p=state.pages[state.playingPage],progress=p?(p.audioURL?Math.min(1,(state.voice.currentTime||0)/p.duration):0):0;
      drawScene(state.playingPage,progress);
      updateTime();
      state.raf=requestAnimationFrame(frame);
    }
    state.raf=requestAnimationFrame(frame);
  }
  function stopPlayback(){
    if(!state.playing&&!state.ctx)return;
    state.session++;state.playing=false;
    clearTimeout(state.sceneTimer);state.sceneTimer=null;
    cancelAnimationFrame(state.raf);state.raf=0;
    if(state.voice){state.voice.onended=null;state.voice.pause();state.voice.removeAttribute("src");state.voice=null;}
    if(state.music){state.music.pause();state.music=null;}
    for(const p of state.pages){if(p.clipEl)try{p.clipEl.pause();}catch(_){}}
    if(state.recorder&&state.recorder.state!=="inactive")state.recorder.stop();
    state.recorder=null;
    if(state.stream)state.stream.getTracks().forEach(t=>t.stop());
    state.stream=null;
    if(state.ctx){state.ctx.close().catch(()=>{});state.ctx=null;}
    updateUI();drawTimeline();getPageImage(state.selected).then(()=>drawScene(state.selected,0)).catch(()=>{});
  }
  function download(blob,name){
    const u=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);
  }
  function downloadScripts(){
    const txt=state.pages.map(p=>"第 "+p.index+" 頁\n"+p.script).join("\n\n---\n\n");
    download(new Blob([txt],{type:"text/plain;charset=utf-8"}),"PDF逐頁旁白.txt");
  }

  // Optional heavyweight models are not silently downloaded. A reviewed
  // ComfyUI API workflow and compatible model must already be installed.
  async function checkAIEngine(){
    if(!state.service){
      state.engineStatus=null;
      ui.pythonStatus.textContent="未連線；請雙擊桌面版 EXE 執行檢查";
      ui.comfyStatus.textContent="無法檢測；請先啟動桌面版";
      ui.engineInfo.textContent="本機服務未連線。請使用桌面版啟動器。";
      updateUI();return;
    }
    try{
      const r=await fetch(LOCAL+"/api/engine/status",{cache:"no-store"});
      const result=await r.json();
      if(!r.ok)throw new Error(result.error||"本機 AI 服務錯誤");
      state.engineStatus=result;
      ui.pythonStatus.textContent=result.python?.installed
        ? "已偵測 Python "+result.python.version+"（桌面版本機環境）"
        : "無法確認 Python；請從官方網站下載";
      ui.comfyStatus.textContent=result.comfyui_ready
        ? "本機 ComfyUI API 已連線（127.0.0.1:8188）"
        : "尚未偵測到執行中的 ComfyUI；如已安裝，請先啟動";
      const gpu=result.hardware?.gpu
        ?result.hardware.name+" · "+Math.round(result.hardware.vram_mb/1024)+"GB VRAM"
        :"未偵測 NVIDIA GPU（仍可使用一般 PDF 製片）";
      const available=result.engines.filter(e=>e.workflow_ready).map(e=>e.id);
      ui.engineInfo.textContent=gpu+"；ComfyUI "+(result.comfyui_ready?"已連線":"未連線")+"；已配置工作流："+(available.join("、")||"無");
      updateUI();
    }catch(e){
      state.engineStatus=null;
      ui.pythonStatus.textContent="本機環境狀態無法取得";
      ui.comfyStatus.textContent="ComfyUI 連線檢查失敗";
      ui.engineInfo.textContent="無法確認 ComfyUI：" + e.message;
      updateUI();
    }
  }
  async function fileToBase64(blob){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result).split(",")[1]);
      reader.onerror=()=>reject(new Error("檔案讀取失敗"));
      reader.readAsDataURL(blob);
    });
  }
  async function makeReferencePNG(index){
    const result=await getPageImage(index),origin=result.canvas;
    const ratio=Math.min(1,768/Math.max(origin.width,origin.height));
    const c=document.createElement("canvas");
    c.width=Math.max(1,Math.round(origin.width*ratio));
    c.height=Math.max(1,Math.round(origin.height*ratio));
    c.getContext("2d").drawImage(origin,0,0,c.width,c.height);
    return fileToBase64(await new Promise(resolve=>c.toBlob(resolve,"image/png")));
  }
  async function generateAIClip(){
    const p=state.pages[state.selected],kind=ui.engine.value;
    if(!p||state.playing||state.clipBusy||!kind)return;
    const installed=state.engineStatus?.engines.find(e=>e.id===kind);
    if(!state.engineStatus?.comfyui_ready||!installed?.workflow_ready){
      ui.clipStatus.textContent="請先啟動 ComfyUI、安裝對應模型並配置可信 API 工作流。";
      return;
    }
    if((kind==="musetalk"||kind==="sadtalker")&&!p.audioURL){
      ui.clipStatus.textContent="數位人口播必須先為目前頁面產生 Edge-TTS 音檔。";return;
    }
    const reference=ui.reference.files[0];
    if((kind==="musetalk"||kind==="sadtalker")&&!reference){
      ui.clipStatus.textContent="數位人口播請先選擇擁有肖像授權的人物 PNG 參考圖。";return;
    }
    if(reference&&(reference.type!=="image/png"||reference.size>8_000_000)){
      ui.clipStatus.textContent="人物參考圖必須為不超過 8 MB 的 PNG。";return;
    }
    state.clipBusy=true;setBusy(true);
    const current=state.selected;
    try{
      ui.clipStatus.textContent="正在準備 "+kind+" 參考素材…";
      const body={
        engine:kind,prompt:ui.clipPrompt.value.trim(),
        image_base64:reference?await fileToBase64(reference):await makeReferencePNG(current)
      };
      if(kind!=="wan22")body.audio_base64=await fileToBase64(await (await fetch(p.audioURL)).blob());
      const res=await api("/api/engine/render",body);
      if(!res.job_id)throw new Error("ComfyUI 未提供任務代碼");
      const jobId=res.job_id;
      ui.clipStatus.textContent="ComfyUI 已排入工作，任務 "+jobId+"；視顯示卡可能需要數分鐘。";
      let complete=false;
      // Job polling is driven by the open browser, not a background assistant.
      for(let attempt=0;attempt<180;attempt++){
        await new Promise(resolve=>setTimeout(resolve,5000));
        const r=await fetch(LOCAL+"/api/engine/job?id="+encodeURIComponent(jobId),{cache:"no-store"});
        const job=await r.json();
        if(!r.ok||job.status==="failed")throw new Error(job.error||"ComfyUI 生成失敗");
        if(job.status==="completed"){
          if(!job.output)throw new Error(job.error||"沒有取得 MP4/WebM 影片檔");
          complete=true;break;
        }
        ui.clipStatus.textContent="AI 影片正在製作…已檢查 "+(attempt+1)+" 次（ComfyUI 任務："+jobId+"）";
      }
      if(!complete)throw new Error("等候逾時，可在 ComfyUI 檢查任務狀態");
      const response=await fetch(LOCAL+"/api/engine/output?id="+encodeURIComponent(jobId));
      if(!response.ok)throw new Error("ComfyUI 完成，但影片下載失敗");
      const blob=await response.blob();
      if(blob.size<2000)throw new Error("AI 影片內容為空");
      const url=URL.createObjectURL(blob);
      const video=document.createElement("video");
      video.src=url;video.muted=true;video.loop=true;video.playsInline=true;video.preload="auto";
      await new Promise((resolve,reject)=>{
        video.onloadeddata=resolve;video.onerror=()=>reject(new Error("瀏覽器無法解碼產出的影片格式"));
        video.load();
      });
      if(p.clipURL)URL.revokeObjectURL(p.clipURL);
      p.clipURL=url;p.clipEl=video;
      ui.clipStatus.textContent="AI 影片已生成並加入第 "+p.index+" 頁，預覽和 WebM 匯出會顯示「AI 生成示意」標記。";
      drawTimeline();
      if(current===state.selected)drawScene(current,0);
    }catch(e){
      ui.clipStatus.textContent="AI 生成未完成："+e.message+"。請檢查 ComfyUI、模型及工作流。";
    }finally{state.clipBusy=false;setBusy(false);}
  }

  ui.file.addEventListener("change",e=>{if(e.target.files[0])loadPDF(e.target.files[0]);});
  ui.title.addEventListener("input",()=>{if(!state.playing)drawScene(state.selected,0);});
  ui.mode.addEventListener("change",()=>{
    if(state.playing)stopPlayback();
    if(ui.mode.value==="underline")applyUnderlineMode();
    if(ui.mode.value==="manual")applyManualMode();
    drawTimeline();chooseScene(state.selected);updateUI();
  });
  ui.editor.addEventListener("input",()=>{
    const p=state.pages[state.selected];if(!p)return;
    if(p.script!==ui.editor.value){p.script=ui.editor.value;revokeAudio(p);drawTimeline();drawScene(state.selected,0);}
  });
  ui.restore.addEventListener("click",()=>{
    const p=state.pages[state.selected];if(!p)return;
    p.script=p.text.slice(0,1800);revokeAudio(p);ui.editor.value=p.script;
    drawTimeline();drawScene(state.selected,0);
  });
  ui.download.addEventListener("click",downloadScripts);
  ui.scripts.addEventListener("click",generateScripts);
  ui.audio.addEventListener("click",generateAudio);
  ui.voice.addEventListener("change",changeAllAudio);
  ui.music.addEventListener("change",()=>{ui.bgm.disabled=!ui.music.checked;ui.volume.disabled=!ui.music.checked;});
  ui.volume.addEventListener("input",()=>ui.volumeLabel.textContent=ui.volume.value+"%");
  ui.bgm.addEventListener("change",e=>{
    if(state.bgmURL)URL.revokeObjectURL(state.bgmURL);
    const f=e.target.files[0];state.bgmURL=f?URL.createObjectURL(f):null;
    say(f?"背景音樂已載入："+f.name:"已取消背景音樂。");
  });
  [ui.template,ui.aspect].forEach(e=>e.addEventListener("change",()=>{if(!state.playing)drawScene(state.selected,0);}));
  ui.play.addEventListener("click",()=>startPlayback(false));
  ui.export.addEventListener("click",()=>startPlayback(true));
  ui.stop.addEventListener("click",stopPlayback);
  window.addEventListener("beforeunload",()=>{for(const p of state.pages)revokeAudio(p);if(state.bgmURL)URL.revokeObjectURL(state.bgmURL);});
  if(typeof pdfjsLib!=="undefined")pdfjsLib.GlobalWorkerOptions.workerSrc="../pdf-voice-video/lib/pdf.worker.min.js";
  ui.engineCheck.addEventListener("click",checkAIEngine);
  ui.engine.addEventListener("change",updateUI);
  ui.clipGenerate.addEventListener("click",generateAIClip);
  ui.health.addEventListener("click",()=>{checkHealth().then(checkAIEngine);});
  window.addEventListener("focus",()=>{checkHealth().then(checkAIEngine);});
  drawScene(0,0);checkHealth().then(checkAIEngine);
})();
