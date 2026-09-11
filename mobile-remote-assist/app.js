import { CloudMedia } from "./cloud-media.js";

const role = document.body.dataset.role;
const $ = (selector) => document.querySelector(selector);
const API_BASE = location.hostname === "ymguan3-boop.github.io" ? "https://mobile-remote-assist-ymguan.kyo1216kimo.chatgpt.site" : "";
const apiUrl = (path) => `${API_BASE}${path}`;
const state = { code: "", token: "", pc: null, localStream: null, microphoneStream: null, pendingCandidates: [], connectionTimer: null, iceRestarted: false, seenEvents: new Set(), poller: null, color: "#ef4444", drawing: false, lastPoint: null, lastSentPoint: null, currentStroke: null, annotations: [], lastStatus: "", lastAnnotationAt: 0 };
const els = { status: $("#session-status"), source: $("#stream-source"), messages: $("#messages"), messageForm: $("#message-form"), messageInput: $("#message-input"), remoteVideo: $("#remote-video"), remoteAudio: $("#remote-audio"), localVideo: $("#local-video"), emptyStage: $("#empty-stage"), canvas: $("#annotation-canvas"), annotationHint: $("#annotation-hint"), connectionNotice: $("#connection-notice"), mobileConnection: $("#mobile-connection-state"), microphoneButton: $("#toggle-microphone") };
const canvas = els.canvas;
const context = canvas?.getContext("2d");
Object.assign(state, { cloud: null, config: null, ended: false, polling: false, mediaStatus: "", mediaError: "", mediaBusy: false });

async function loadMediaConfig() {
  const response = await fetch(apiUrl("/api/media-config"), { cache: "no-store" });
  if (!response.ok) throw new Error("無法讀取媒體連線設定");
  state.config = await response.json();
  setText($("#network-status"), state.config.relayAvailable ? "雲端中繼已設定，等待媒體連線" : "中繼尚未啟用；受限網路可能無法傳送影像");
}

function showMediaError(message) {
  state.mediaError = message;
  setText(els.status, "媒體連線未完成");
  setText(els.connectionNotice || els.mobileConnection, message);
  setText($("#network-status"), message);
}

function attachRemoteTrack(track) {
  if (state.ended) return;
  const mediaTrack = track.mediaStreamTrack || track;
  const element = mediaTrack.kind === "video" ? els.remoteVideo : els.remoteAudio;
  if (!element) return;
  if (mediaTrack.kind === "video") element.muted = true;
  if (track.attach) track.attach(element);
  else element.srcObject = new MediaStream([mediaTrack]);
  if (mediaTrack.kind === "video") {
    element.onplaying = () => {
      if (state.ended || element.videoWidth === 0) return;
      els.emptyStage.hidden = true;
      setText(els.source, "手機鏡頭分享中");
      updateConnectionNotice("active", true);
    };
  }
  element.play().catch(() => { $("#resume-media").hidden = false; });
}

async function ensureMedia() {
  if (!state.code || state.ended) throw new Error("請先建立或加入工作階段");
  if (!state.config) await loadMediaConfig();
  if (state.config.transport !== "livekit") return null;
  if (!state.cloud) {
    const cloud = new CloudMedia({
      token: () => post("/api/livekit/token", { code: state.code }),
      onStatus: (status) => {
        if (state.cloud !== cloud || state.ended) return;
        state.mediaStatus = status; state.mediaError = "";
        updateConnectionNotice(status);
        setText(els.status, status === "active" ? "已連線" : status === "waiting" ? "等待另一端進入媒體連線" : "雲端連線中");
      },
      onTrack: attachRemoteTrack,
      onTrackRemoved: (track) => {
        track.detach();
        if (track.kind === "video" && els.emptyStage) { els.emptyStage.hidden = false; setText(els.source, "手機端已停止分享"); }
      },
      onAudioBlocked: (blocked) => { $("#resume-media").hidden = !blocked; },
      onEnd: (message) => disconnectSession(message),
    });
    state.cloud = cloud;
  }
  try { await state.cloud.connect(); return state.cloud; }
  catch (error) {
    showMediaError("雲端連線失敗：請檢查免費額度或網路是否允許 LiveKit 加密連線");
    throw error;
  }
}

function setText(el, value) { if (el) el.textContent = value; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function addMessage(from, text, self = false) { const item = document.createElement("div"); item.className = `message${self ? " self" : ""}`; const label = from === "mobile" ? "手機端" : from === "helper" ? "協助人員" : "系統"; item.innerHTML = `<small>${label}</small>${escapeHtml(text)}`; els.messages?.append(item); if (els.messages) els.messages.scrollTop = els.messages.scrollHeight; }
function statusLabel(status) { return ({ waiting: "等待協助人員", connecting: "正在連線", active: "已連線", paused: "已暫停", resolved: "已完成" })[status] || status; }
function playConnectionTone() { try { const audio = new AudioContext(); const oscillator = audio.createOscillator(); const gain = audio.createGain(); oscillator.frequency.value = 880; gain.gain.setValueAtTime(0.08, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.25); oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + 0.25); } catch {} }
function updateConnectionNotice(status, sharing = false) { const changed = state.lastStatus !== status; state.lastStatus = status; if (role === "mobile" && els.mobileConnection) { if (status === "active") { els.mobileConnection.textContent = "主控台已連線"; els.mobileConnection.dataset.state = "connected"; } else if (status === "connecting") { els.mobileConnection.textContent = "主控台正在連線"; els.mobileConnection.dataset.state = "connecting"; } else { els.mobileConnection.textContent = "等待主控台加入"; els.mobileConnection.dataset.state = "waiting"; } return; } if (role !== "helper" || !els.connectionNotice) return; if (sharing) { els.connectionNotice.textContent = "已連線，手機端正在分享"; els.connectionNotice.dataset.state = "sharing"; } else if (status === "active") { els.connectionNotice.textContent = "手機端已連線"; els.connectionNotice.dataset.state = "connected"; } else if (status === "connecting") { els.connectionNotice.textContent = "正在與手機端連線"; els.connectionNotice.dataset.state = "connected"; } else { els.connectionNotice.textContent = "等待手機端連線"; els.connectionNotice.dataset.state = "idle"; } if (changed && status === "active") playConnectionTone(); }
function updateEventCount() { const el = $("#event-count"); if (el) el.textContent = String(state.seenEvents.size); }
async function post(path, data = {}) { const res = await fetch(apiUrl(path), { method: "POST", headers: { "content-type": "application/json", ...(state.token ? { "x-session-token": state.token } : {}) }, body: JSON.stringify(data) }); const body = await res.json(); if (!res.ok) throw new Error(body.error || "請求失敗"); return body; }

function resizeCanvas() {
  if (!canvas) return;
  const box = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const snapshot = document.createElement("canvas"); snapshot.width = canvas.width; snapshot.height = canvas.height;
  snapshot.getContext("2d").drawImage(canvas, 0, 0);
  canvas.width = Math.max(1, Math.round(box.width * ratio)); canvas.height = Math.max(1, Math.round(box.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  redrawAnnotations();
}
function drawSegment(segment) {
  if (!context || !canvas || !segment) return;
  const box = canvas.getBoundingClientRect();
  context.save(); context.strokeStyle = segment.color || "#ef4444"; context.lineWidth = 4; context.lineCap = "round"; context.lineJoin = "round";
  context.beginPath(); context.moveTo(segment.from.x * box.width, segment.from.y * box.height); context.lineTo(segment.to.x * box.width, segment.to.y * box.height); context.stroke(); context.restore();
}
function clearAnnotations() { if (context && canvas) context.clearRect(0, 0, canvas.width, canvas.height); }
function redrawAnnotations() { clearAnnotations(); state.annotations.forEach(drawSegment); }
function applyAnnotation(payload) {
  if (!payload) return;
  if (payload.action === "draw" && payload.segment) { state.annotations.push(payload.segment); drawSegment(payload.segment); }
  if (payload.action === "undo" && payload.strokeId) { state.annotations = state.annotations.filter((segment) => segment.strokeId !== payload.strokeId); redrawAnnotations(); }
  if (payload.action === "clear") { state.annotations = []; clearAnnotations(); }
}
function pointFromEvent(event) { const box = canvas.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) }; }
async function sendAnnotation(payload) { if (state.code) await post(`/api/session/${state.code}/annotation`, { from: role, payload }); }
function enableDrawing() {
  if (role !== "helper" || !canvas) return;
  canvas.addEventListener("pointerdown", (event) => { if (!state.code) return; state.drawing = true; state.lastPoint = pointFromEvent(event); state.lastSentPoint = state.lastPoint; state.currentStroke = `${Date.now()}-${Math.random().toString(36).slice(2)}`; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener("pointermove", (event) => { if (!state.drawing || !state.lastPoint) return; const next = pointFromEvent(event); const localSegment = { from: state.lastPoint, to: next, color: state.color, strokeId: state.currentStroke }; state.lastPoint = next; applyAnnotation({ action: "draw", segment: localSegment }); const now = Date.now(); if (now - state.lastAnnotationAt >= 67 && state.lastSentPoint) { const networkSegment = { from: state.lastSentPoint, to: next, color: state.color, strokeId: state.currentStroke }; state.lastSentPoint = next; state.lastAnnotationAt = now; sendAnnotation({ action: "draw", segment: networkSegment }).catch(() => {}); } });
  const stop = (event) => { if (!state.drawing) return; const finalPoint = pointFromEvent(event); if (state.lastSentPoint && (finalPoint.x !== state.lastSentPoint.x || finalPoint.y !== state.lastSentPoint.y)) sendAnnotation({ action: "draw", segment: { from: state.lastSentPoint, to: finalPoint, color: state.color, strokeId: state.currentStroke } }).catch(() => {}); state.drawing = false; state.lastPoint = null; state.lastSentPoint = null; state.currentStroke = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); };
  canvas.addEventListener("pointerup", stop); canvas.addEventListener("pointercancel", stop);
  document.querySelectorAll("[data-color]").forEach((button) => button.addEventListener("click", () => { state.color = button.dataset.color; document.querySelectorAll("[data-color]").forEach((item) => item.classList.toggle("selected", item === button)); }));
  $("#undo-annotation")?.addEventListener("click", () => { const strokeId = state.annotations.at(-1)?.strokeId; if (!strokeId) return; applyAnnotation({ action: "undo", strokeId }); sendAnnotation({ action: "undo", strokeId }).catch(() => {}); });
  $("#clear-annotations")?.addEventListener("click", () => { applyAnnotation({ action: "clear" }); sendAnnotation({ action: "clear" }).catch(() => {}); });
}

async function pollSession() {
  if (!state.code || !state.token || state.ended || state.polling) return;
  state.polling = true;
  const token = state.token;
  try {
    const res = await fetch(apiUrl(`/api/session/${state.code}`), { cache: "no-store", headers: { "x-session-token": token } });
    const session = await res.json();
    if (state.ended || state.token !== token) return;
    if ([403, 404, 410].includes(res.status)) { disconnectSession("工作階段已失效，請重新建立代碼"); return; }
    if (!res.ok) throw new Error(session.error || "連線不存在");
    if (session.status === "resolved") { disconnectSession("主控端已停止連線"); return; }
    if (!state.mediaError) {
      const mediaConnected = state.cloud ? state.mediaStatus === "active" : state.pc?.connectionState === "connected";
      setText(els.status, mediaConnected ? "已連線" : statusLabel(session.status === "active" ? "connecting" : session.status));
      updateConnectionNotice(mediaConnected ? "active" : session.status === "active" ? "connecting" : session.status, Boolean(els.remoteVideo?.videoWidth && els.remoteVideo?.readyState >= 2));
    }
    for (const event of session.events || []) { if (state.ended) break; await processEvent(event); }
  } finally { state.polling = false; }
}
async function processEvent(event) { const id = `${event.at || ""}:${event.type}:${event.from || ""}:${JSON.stringify(event.payload || event.text || event.status || "")}`; if (state.seenEvents.has(id)) return; if (event.type === "signal" && event.from !== role) await handleSignal(event.payload); state.seenEvents.add(id); updateEventCount(); if (event.type === "message") addMessage(event.from, event.text, event.from === role); if (event.type === "status" && event.status === "resolved") disconnectSession("主控端已停止連線"); if (event.type === "annotation" && event.from !== role) { applyAnnotation(event.payload); if (role === "mobile" && els.annotationHint) { els.annotationHint.hidden = false; window.clearTimeout(els.annotationHint.timer); els.annotationHint.timer = window.setTimeout(() => { els.annotationHint.hidden = true; }, 2400); } } }
function disconnectSession(message) {
  state.ended = true;
  clearInterval(state.poller); clearTimeout(state.connectionTimer);
  state.poller = null; state.connectionTimer = null; state.pendingCandidates = [];
  state.cloud?.close().catch(() => {}); state.cloud = null;
  state.localStream?.getTracks().forEach((track) => track.stop());
  state.microphoneStream?.getTracks().forEach((track) => track.stop());
  state.pc?.close(); state.pc = null; state.localStream = null; state.microphoneStream = null;
  for (const element of [els.localVideo, els.remoteVideo, els.remoteAudio]) { if (element) { element.pause(); element.srcObject = null; } }
  if (els.emptyStage) els.emptyStage.hidden = false;
  setText(els.status, message); setText(els.source, "連線已停止");
  setText(els.connectionNotice || els.mobileConnection, message);
  state.token = ""; state.code = "";
  updateMicrophoneButton();
}
function connectEvents() { if (state.poller) clearInterval(state.poller); pollSession().catch((error) => addMessage("system", `同步失敗：${error.message}`)); state.poller = setInterval(() => pollSession().catch(() => {}), 1500); }
function createPeer() {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  pc.onicecandidate = ({ candidate }) => { if (candidate && !state.ended) sendSignal({ candidate }).catch((error) => showMediaError(`連線訊號傳送失敗：${error.message}`)); };
  pc.onconnectionstatechange = () => {
    if (state.ended || state.pc !== pc) return;
    if (pc.connectionState === "connected") {
      clearTimeout(state.connectionTimer); state.mediaError = "";
      setText(els.status, "已連線"); updateConnectionNotice("active");
      setText($("#network-status"), "直接媒體連線已建立（未使用中繼）");
    } else if (["failed", "disconnected"].includes(pc.connectionState)) {
      showMediaError("直接連線未成功；此網站尚未啟用中繼，受限網路可能無法傳送影像");
    }
  };
  pc.ontrack = ({ track }) => attachRemoteTrack(track);
  state.pc = pc;
  return pc;
}
async function sendSignal(payload) { if (state.code) await post(`/api/session/${state.code}/signal`, { from: role, payload }); }
async function handleSignal(payload) { if (state.ended || state.config?.transport === "livekit") return; const pc = state.pc || createPeer(); if (payload.description) { await pc.setRemoteDescription(payload.description); const queued = state.pendingCandidates.splice(0); for (const candidate of queued) { await pc.addIceCandidate(candidate); } if (payload.description.type === "offer") { const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); await sendSignal({ description: pc.localDescription }); } } if (payload.candidate) { if (pc.remoteDescription) await pc.addIceCandidate(payload.candidate); else state.pendingCandidates.push(payload.candidate); } }
async function startMobile() { await loadMediaConfig(); const session = await post("/api/session"); state.code = session.code; state.token = session.participantToken; state.ended = false; setText($("#pair-code"), session.code); connectEvents(); setText(els.status, "等待協助人員"); }
async function startStream() {
  if (state.mediaBusy) return;
  state.mediaBusy = true;
  let stream;
  try {
    const cloud = await ensureMedia();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15, max: 24 } }, audio: true });
    if (state.ended) throw new Error("工作階段已停止");
    if (cloud) await cloud.publish(stream);
    else {
      const pc = state.pc || createPeer();
      for (const track of stream.getTracks()) {
        const sender = pc.getSenders().find((item) => item.track?.kind === track.kind);
        if (sender) await sender.replaceTrack(track); else pc.addTrack(track, stream);
      }
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await sendSignal({ description: pc.localDescription });
    }
    if (state.ended) throw new Error("工作階段已停止");
    state.localStream?.getTracks().forEach((track) => track.stop());
    state.microphoneStream?.getTracks().forEach((track) => track.stop());
    state.localStream = stream; state.microphoneStream = stream; els.localVideo.srcObject = stream;
    setText(els.source, "手機鏡頭與語音分享"); updateMicrophoneButton();
  } catch (error) { stream?.getTracks().forEach((track) => track.stop()); addMessage("system", `無法開始分享：${error.message}`); }
  finally { state.mediaBusy = false; }
}
function updateMicrophoneButton() { const track = state.microphoneStream?.getAudioTracks()[0]; if (!els.microphoneButton) return; const muted = !track || !track.enabled; els.microphoneButton.textContent = muted ? "啟動麥克風" : "麥克風已開啟（點此靜音）"; els.microphoneButton.dataset.muted = String(muted); }
async function toggleMicrophone() {
  if (state.mediaBusy) return;
  state.mediaBusy = true;
  let stream;
  try {
    const current = state.microphoneStream?.getAudioTracks()[0];
    if (current && current.readyState !== "ended") { current.enabled = !current.enabled; updateMicrophoneButton(); return; }
    const cloud = await ensureMedia();
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (state.ended) throw new Error("工作階段已停止");
    if (cloud) await cloud.publish(stream);
    else {
      const pc = state.pc || createPeer();
      stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
      if (pc.remoteDescription) { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await sendSignal({ description: pc.localDescription }); }
    }
    if (state.ended) throw new Error("工作階段已停止");
    state.microphoneStream = stream; updateMicrophoneButton();
  } catch (error) { stream?.getTracks().forEach((track) => track.stop()); addMessage("system", `無法啟動麥克風：${error.message}`); }
  finally { state.mediaBusy = false; }
}
async function joinHelper() {
  const button = $("#join-session");
  if (button.disabled) return;
  const code = $("#join-code").value.trim();
  if (!/^\d{4}$/.test(code)) return addMessage("system", "請輸入 4 位數協助代碼");
  if (state.code && !state.ended) return addMessage("system", "請先停止目前連線");
  button.disabled = true;
  try {
    await loadMediaConfig();
    const res = await fetch(apiUrl(`/api/session/${code}/join`), { method: "POST" });
    const session = await res.json();
    if (!res.ok) throw new Error(session.error || "無法加入這組協助代碼");
    state.code = code; state.token = session.participantToken; state.ended = false;
    state.mediaError = ""; state.mediaStatus = ""; state.seenEvents.clear();
    setText(els.status, "正在連線"); updateConnectionNotice("connecting");
    connectEvents();
    if (state.config.transport === "livekit") await ensureMedia(); else createPeer();
  } finally { button.disabled = false; }
}
els.messageForm?.addEventListener("submit", async (event) => { event.preventDefault(); const text = els.messageInput.value.trim(); if (!text || !state.code) return; els.messageInput.value = ""; await post(`/api/session/${state.code}/message`, { from: role, text }); });
$("#stop-session")?.addEventListener("click", async () => {
  if (!state.code || !confirm("確定停止本次連線？")) return;
  const stop = post(`/api/session/${state.code}/stop`, { from: role });
  disconnectSession("已停止本機連線");
  try { await stop; setText(els.status, "已停止連線"); }
  catch { addMessage("system", "本機已停止，但無法通知手機端。請手機端關閉頁面以停止分享。"); }
});
$("#resume-media")?.addEventListener("click", async () => {
  try {
    await state.cloud?.playAudio();
    for (const element of [els.remoteVideo, els.remoteAudio]) if (element?.srcObject) await element.play();
    $("#resume-media").hidden = true;
  } catch { addMessage("system", "播放仍遭瀏覽器阻擋，請檢查網站的聲音權限。"); }
});
$("#show-help")?.addEventListener("click", () => $("#help-dialog")?.showModal());
$("#close-help")?.addEventListener("click", () => $("#help-dialog")?.close());
els.microphoneButton?.addEventListener("click", toggleMicrophone);
if (canvas) { resizeCanvas(); new ResizeObserver(resizeCanvas).observe(canvas); }
enableDrawing();
if (role === "mobile") { startMobile().catch((error) => addMessage("system", `無法建立連線：${error.message}`)); $("#start-camera").addEventListener("click", startStream); }
if (role === "helper") { $("#join-session").addEventListener("click", () => joinHelper().catch((error) => addMessage("system", error.message))); $("#join-code").addEventListener("keydown", (event) => { if (event.key === "Enter") joinHelper().catch(() => {}); }); }
