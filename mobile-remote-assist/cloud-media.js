let sdkPromise;
async function loadLiveKit() {
  sdkPromise ||= import(new URL("./vendor/livekit-client.umd.js", import.meta.url).href);
  await sdkPromise;
  return globalThis.LivekitClient;
}

export class CloudMedia {
  constructor({ token, onStatus, onTrack, onTrackRemoved, onAudioBlocked, onEnd, relayOnly = false, loadSdk = loadLiveKit }) {
    Object.assign(this, { token, onStatus, onTrack, onTrackRemoved, onAudioBlocked, onEnd, relayOnly });
    this.loadSdk = loadSdk;
    this.room = null;
    this.closed = false;
    this.pending = null;
  }

  connect() {
    if (!this.pending) this.pending = this.open();
    return this.pending;
  }

  async open() {
    try {
      this.sdk = await this.loadSdk();
      const access = await this.token();
      if (this.closed) throw new Error("連線已停止");
      const { Room, RoomEvent } = this.sdk;
      const room = new Room({ adaptiveStream: true, dynacast: true });
      this.room = room;
      const report = () => this.onStatus(room.remoteParticipants.size ? "active" : "waiting");
      room.on(RoomEvent.ParticipantConnected, report);
      room.on(RoomEvent.ParticipantDisconnected, () => this.onStatus("waiting"));
      room.on(RoomEvent.TrackSubscribed, (track) => this.onTrack(track));
      room.on(RoomEvent.TrackUnsubscribed, (track) => this.onTrackRemoved(track));
      room.on(RoomEvent.Reconnecting, () => this.onStatus("reconnecting"));
      room.on(RoomEvent.Reconnected, report);
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => this.onAudioBlocked(!room.canPlaybackAudio));
      room.on(RoomEvent.Disconnected, () => { if (!this.closed) this.onEnd("雲端媒體連線已中斷，請重新加入。"); });
      this.onStatus("connecting");
      await room.connect(access.server_url, access.participant_token, {
        autoSubscribe: true, peerConnectionTimeout: 25000,
        ...(this.relayOnly ? { rtcConfig: { iceTransportPolicy: "relay" } } : {}),
      });
      if (this.closed) { await room.disconnect(); throw new Error("連線已停止"); }
      this.deadline = setTimeout(() => this.onEnd("已達工作階段最長 30 分鐘"), Math.max(0, access.expires_at - Date.now()));
      report();
      return room;
    } catch (error) {
      this.pending = null;
      await this.room?.disconnect();
      this.room = null;
      throw error;
    }
  }

  async publish(stream) {
    const room = await this.connect();
    if (this.closed) { stream.getTracks().forEach((track) => track.stop()); throw new Error("連線已停止"); }
    const { Track } = this.sdk;
    for (const track of stream.getTracks()) {
      const source = track.kind === "video" ? Track.Source.Camera : Track.Source.Microphone;
      const old = room.localParticipant.getTrackPublication(source);
      if (old?.track?.mediaStreamTrack === track) continue;
      if (old?.track) await room.localParticipant.unpublishTrack(old.track, true);
      if (this.closed) { track.stop(); throw new Error("連線已停止"); }
      await room.localParticipant.publishTrack(track, { source });
    }
  }

  async playAudio() { await this.room?.startAudio(); }

  async close() {
    this.closed = true;
    clearTimeout(this.deadline);
    await this.room?.disconnect();
  }
}
