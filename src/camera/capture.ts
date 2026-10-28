export class Capture {
  stream: MediaStream | null = null;
  settings: MediaTrackSettings = {};
  capabilities: MediaTrackCapabilities | null = null;
  readonly requested = {
    facingMode: "user",
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 30, max: 30 },
  };
  async start(video: HTMLVideoElement) {
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw Error(
        "Camera requires HTTPS (or localhost on this computer). LAN HTTP is not a secure origin.",
      );
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: this.requested,
      audio: false,
    });
    const track = this.stream.getVideoTracks()[0];
    this.settings = track.getSettings();
    this.capabilities = track.getCapabilities?.() ?? null;
    video.srcObject = this.stream;
    await video.play();
    return track;
  }
  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
