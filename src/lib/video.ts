// Offline MP4 export: renders frames at fixed time steps (not real time), so the
// clip is smooth however slow the encode is. Uses the browser's H.264 encoder
// (WebCodecs) through mediabunny.
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, canEncodeVideo } from "mediabunny";

export const VIDEO_SECONDS = 5; // without a timeline
export const VIDEO_FPS = 30;

// H.264 needs even dimensions and has a size ceiling that varies by browser;
// step down until the encoder accepts it
async function encodableSize(w: number, h: number): Promise<[number, number] | null> {
  for (let s = 1; s >= 0.2; s *= 0.8) {
    const ew = Math.max(2, Math.floor((w * s) / 2) * 2);
    const eh = Math.max(2, Math.floor((h * s) / 2) * 2);
    if (await canEncodeVideo("avc", { width: ew, height: eh, quality: QUALITY_HIGH, frameRate: VIDEO_FPS })) return [ew, eh];
  }
  return null;
}

export async function recordMp4(
  src: HTMLCanvasElement,
  draw: (timeMs: number) => void,
  onProgress: (done: number) => void,
  seconds = VIDEO_SECONDS,
): Promise<Blob> {
  if (typeof VideoEncoder === "undefined") throw new Error("This browser can't encode video (no WebCodecs).");
  const size = await encodableSize(src.width, src.height);
  if (!size) throw new Error("This browser can't encode H.264 video at this size.");

  // Frames are copied into an even-sized 2D canvas, which is what gets encoded
  const c = document.createElement("canvas");
  [c.width, c.height] = size;
  const x = c.getContext("2d")!;

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const video = new CanvasSource(c, { codec: "avc", quality: QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: VIDEO_FPS });
  await output.start();

  const frames = Math.max(1, Math.round(seconds * VIDEO_FPS));
  for (let i = 0; i < frames; i++) {
    draw((i / VIDEO_FPS) * 1000);
    x.drawImage(src, 0, 0, c.width, c.height);
    await video.add(i / VIDEO_FPS, 1 / VIDEO_FPS);
    onProgress((i + 1) / frames);
  }
  await output.finalize();
  return new Blob([target.buffer!], { type: "video/mp4" });
}
