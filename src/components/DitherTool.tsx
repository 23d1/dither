"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Controls from "./Controls";
import Presets, { type Preset } from "./Presets";
import { DitherEngine, placeholderImage, type Focus } from "@/lib/engine";
import { CHARSETS, UNICODE_SET, defaultParams, glyphChars, presetParams, sanitizeParams, type Params, type Value } from "@/lib/params";
import { loadImage, loadSession, saveImage, saveSession } from "@/lib/session";
import { VIDEO_SECONDS, recordMp4 } from "@/lib/video";
import { pickGlyphs } from "@/lib/glyphs";

const GUIDE_CSS_PX = 1.5; // outline width on screen
const AUTOSAVE_MS = 400;

export default function DitherTool() {
  const [params, setParams] = useState<Params>(defaultParams);
  const [focus, setFocus] = useState<Focus>({ x: 0.5, y: 0.5 });
  const [img, setImg] = useState({ w: 1600, h: 1000 });
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [recording, setRecording] = useState<number | null>(null); // MP4 export progress 0..1
  const [glyphProgress, setGlyphProgress] = useState<number | null>(null); // big charset survey 0..1

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const engineRef = useRef<DitherEngine | null>(null);
  const dirty = useRef(true);
  const dragging = useRef(false);
  const recordingRef = useRef(false); // pauses the preview loop while frames are captured
  const restored = useRef(false); // don't autosave defaults over the stored session
  const imageChosen = useRef(false); // an image picked during startup beats the stored one

  // Fit the image inside the stage
  const guide = !!params.guide;
  const fit = Math.max(0.0001, Math.min((stage.w - 32) / img.w, (stage.h - 32) / img.h));
  const cssW = Math.max(1, img.w * fit);
  const cssH = Math.max(1, img.h * fit);

  // The render loop reads the latest values from here
  const live = useRef({ params, focus, guide, guidePx: 1 });
  useEffect(() => {
    live.current = { params, focus, guide, guidePx: GUIDE_CSS_PX * (img.w / cssW) };
    dirty.current = true;
  }, [params, focus, guide, img.w, cssW]);

  // Decode an image into the engine; persist it as the session image if asked
  const showImage = useCallback((blob: Blob, persist: boolean) => {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => {
      // SVGs without width/height report 0x0; give them a usable size
      const w = im.naturalWidth || 1024, h = im.naturalHeight || 1024;
      const engine = engineRef.current;
      if (engine) {
        engine.setSource(im, w, h);
        setImg({ w: engine.width, h: engine.height });
        dirty.current = true;
        if (persist) saveImage(blob);
      }
      URL.revokeObjectURL(url);
    };
    im.onerror = () => { URL.revokeObjectURL(url); if (persist) alert("Could not read that image."); };
    im.src = url;
  }, []);

  // Autosave settings + focus shortly after they stop changing
  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => saveSession({ params, focus }), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [params, focus]);

  // Engine + render loop
  useEffect(() => {
    let engine: DitherEngine;
    try {
      engine = new DitherEngine(canvasRef.current!);
    } catch (e) {
      // One-off result of initialising an external system (WebGL), not derived state
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError((e as Error).message);
      return;
    }
    engineRef.current = engine;
    const ph = placeholderImage();
    engine.setSource(ph, ph.width, ph.height);
    setImg({ w: engine.width, h: engine.height });

    // Pick up where the last session left off
    const s = loadSession();
    if (s) { setParams(s.params); setFocus(s.focus); }
    restored.current = true;
    loadImage().then(b => { if (b && !imageChosen.current) showImage(b, false); });

    let raf = 0;
    const loop = (t: number) => {
      const { params: p, focus: f, guide: g, guidePx } = live.current;
      const moving = isMoving(p);
      if (!recordingRef.current && (dirty.current || moving)) {
        engine.render(p, f, t, { guide: g, guidePx });
        dirty.current = false;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      engineRef.current = null;
    };
  }, [showImage]);

  // Glyph atlas follows the charset. Huge sets (all of Unicode) are surveyed in
  // the background first; the previous glyphs stay up until the new ones are ready.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    let cancelled = false;
    pickGlyphs(glyphChars(params), engine.glyphCap, !!params.fitEach,
      p => { if (!cancelled) setGlyphProgress(p); }, () => cancelled)
      .then(list => {
        if (!list || cancelled) return;
        engine.setGlyphs(list, !!params.sortInk, !!params.fitEach);
        dirty.current = true;
        setGlyphProgress(null);
      });
    return () => { cancelled = true; setGlyphProgress(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only these shape the atlas
  }, [params.chars, params.charset, params.sortInk, params.fitEach]);

  // Stage size
  useEffect(() => {
    const el = stageRef.current!;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setParam = useCallback((id: string, v: Value) => {
    setParams(p => {
      const next = { ...p, [id]: v };
      // Dropdown and text field stay in sync; typing switches the dropdown to Custom
      if (id === "charset" && Number(v) >= 0) next.chars = CHARSETS[Number(v)][1];
      if (id === "chars") next.charset = CHARSETS.findIndex((c, i) => i !== UNICODE_SET && c[1] === v);
      return next;
    });
  }, []);

  // Dev-only handle for scripted visual checks
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    (window as unknown as Record<string, unknown>).__dither = { setParam, setFocus, glyphs: () => engineRef.current?.glyphCount };
  }, [setParam]);

  const loadFile = useCallback((file?: File | null) => {
    if (!file || !file.type.startsWith("image/")) return;
    imageChosen.current = true;
    showImage(file, true);
  }, [showImage]);

  // Drop, paste, keyboard
  useEffect(() => {
    const over = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDragOver(false); };
    const drop = (e: DragEvent) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer?.files[0]); };
    const paste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith("image/"));
      if (item) loadFile(item.getAsFile());
    };
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((t.tagName === "INPUT" && (t as HTMLInputElement).type === "text") || t.tagName === "SELECT") return;
      if (e.key === "h" || e.key === "H") setParams(p => ({ ...p, guide: !p.guide }));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
      window.removeEventListener("keydown", key);
    };
  }, [loadFile]);

  const focusFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setFocus({
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    });
  };

  const currentPreset = (): Preset => ({ params: presetParams(params), focus });
  const applyPreset = (p: Partial<Preset>) => {
    // Keep the current view settings (guide, field view); take everything else from the preset
    setParams(cur => ({ ...sanitizeParams(p.params), guide: cur.guide, showField: cur.showField }));
    const f = p.focus;
    if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) {
      setFocus({ x: Math.min(1, Math.max(0, f.x)), y: Math.min(1, Math.max(0, f.y)) });
    }
  };

  const moving = isMoving(params);

  const exportMp4 = async () => {
    const engine = engineRef.current, canvas = canvasRef.current;
    if (!engine || !canvas || recordingRef.current) return;
    recordingRef.current = true;
    setRecording(0);
    try {
      const blob = await recordMp4(canvas,
        t => engine.render(params, focus, t, { guide: false, guidePx: 1 }),
        setRecording);
      download(blob, "focal-dither.mp4");
    } catch (e) {
      alert(`Could not export video: ${(e as Error).message}`);
    } finally {
      recordingRef.current = false;
      dirty.current = true;
      setRecording(null);
    }
  };

  const exportPng = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.render(params, focus, performance.now(), { guide: false, guidePx: 1 });
    const blob = await engine.toBlob();
    dirty.current = true;
    if (blob) download(blob, "focal-dither.png");
  };

  return (
    <div className="app">
      <main className="stage" ref={stageRef}>
        {error ? (
          <div className="err">{error}</div>
        ) : (
          <div className="frame" style={{ width: cssW, height: cssH }}>
            <canvas
              ref={canvasRef}
              className={fit >= 1 ? "up" : undefined}
              onPointerDown={e => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); focusFromEvent(e); }}
              onPointerMove={e => { if (dragging.current) focusFromEvent(e); }}
              onPointerUp={() => { dragging.current = false; }}
              onPointerCancel={() => { dragging.current = false; }}
            />
            {guide && <div className="marker" style={{ left: `${focus.x * 100}%`, top: `${focus.y * 100}%` }} />}
          </div>
        )}
        {dragOver && <div className="drop">Drop image</div>}
        {guide && <div className="hint">drag to move focus · H toggles guide · drop / paste an image</div>}
      </main>
      <aside>
        <h1>Focal <span>Dither</span></h1>
        <div className="btns">
          <label className="btn">Upload<input type="file" accept="image/*" onChange={e => { loadFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
          <button className="btn" onClick={exportPng}>Export PNG</button>
        </div>
        <div className="btns">
          <button className="btn" onClick={exportMp4} disabled={recording !== null || !moving}
            title={moving ? `Render ${VIDEO_SECONDS}s of the animation`
              : params.animate ? "Nothing moves: raise Drift, Noise or ASCII scramble" : "Turn on Animate to export video"}>
            {recording === null ? `Export MP4 · ${VIDEO_SECONDS}s` : `Rendering video… ${Math.round(recording * 100)}%`}
          </button>
        </div>
        <div className="btns">
          <button className="btn" onClick={() => setFocus({ x: 0.5, y: 0.5 })}>Center</button>
          <button className="btn" onClick={() => { setParams(p => ({ ...defaultParams(), guide: p.guide })); setFocus({ x: 0.5, y: 0.5 }); }}>Reset</button>
        </div>
        {glyphProgress !== null && <div className="status">Measuring Unicode glyphs… {Math.round(glyphProgress * 100)}%</div>}
        <Presets current={currentPreset} apply={applyPreset} />
        <Controls params={params} setParam={setParam} />
      </aside>
    </div>
  );
}

// Something on screen changes over time while Animate is on: noise, ASCII
// scramble, or drifting influence (spread squares, organic noise)
function isMoving(p: Params) {
  return !!p.animate && (
    (!!p.noiseOn && Number(p.noise) > 0) ||
    (Number(p.drift) > 0 && (Number(p.spreadBands) > 0 || !!p.organicOn)) ||
    (!!p.asciiOn && Number(p.ascii) > 0 && Number(p.scramble) > 0));
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
