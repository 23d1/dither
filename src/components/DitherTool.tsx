"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Controls from "./Controls";
import Presets, { type Preset } from "./Presets";
import Timeline from "./Timeline";
import type { KeyState } from "./KeyButton";
import { DitherEngine, type Focus } from "@/lib/engine";
import { GROUPS, defaultParams, glyphChars, presetParams, sanitizeParams, withParam, type Params, type Value } from "@/lib/params";
import { loadImage, loadSession, saveImage, saveSession } from "@/lib/session";
import { VIDEO_SECONDS, recordMp4 } from "@/lib/video";
import { pickGlyphs } from "@/lib/glyphs";
import {
  DEFAULT_FOCUS, FOCUS, animatable, clampFocus, emptyTimeline, hasKey, isAnimated, moveKey, removeKey, removeTrack,
  sample, sanitizeTimeline, setDuration, setKey, type Ease, type Timeline as TL,
} from "@/lib/timeline";

const GUIDE_CSS_PX = 1.5; // outline width on screen
// Row labels, prefixed with their section where a label alone is ambiguous ("Amount")
const LABELS = new Map(GROUPS.flatMap(g => g.rows.map(r => [r.id, r.label === "Amount" ? `${g.title} amount` : r.label] as const)));
const AUTOSAVE_MS = 400;
const DEFAULT_IMAGE = "/default.jpg"; // shown until an image is dropped or picked

export default function DitherTool() {
  const [params, setParams] = useState<Params>(defaultParams);
  const [focus, setFocus] = useState<Focus>(DEFAULT_FOCUS);
  const [img, setImg] = useState({ w: 1920, h: 1080 });
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [recording, setRecording] = useState<number | null>(null); // MP4 export progress 0..1
  const [glyphProgress, setGlyphProgress] = useState<number | null>(null); // big charset survey 0..1
  const [timeline, setTimeline] = useState<TL>(emptyTimeline);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const engineRef = useRef<DitherEngine | null>(null);
  const dirty = useRef(true);
  // Drag start: pointer position and the focus at that moment, so dragging moves
  // the focus by the pointer's offset instead of jumping it under the cursor
  const drag = useRef<{ x: number; y: number; focus: Focus } | null>(null);
  const recordingRef = useRef(false); // pauses the preview loop while frames are captured
  const restored = useRef(false); // don't autosave defaults over the stored session
  const imageChosen = useRef(false); // an image picked during startup beats the stored one
  // Playback clock: time origin (performance.now at t=0), current time, last UI update
  const clock = useRef({ origin: 0, t: 0, tick: 0 });

  // What's shown (and what the controls display): the plain settings, with each
  // animated property replaced by its track sampled at the playhead
  const at = useMemo(() => sample(timeline, playhead), [timeline, playhead]);
  const shown = useMemo(() => ({ ...params, ...at.params }), [params, at]);
  const shownFocus = at.focus ?? focus;

  // Fit the image inside the stage
  const guide = !!shown.guide;
  const fit = Math.max(0.0001, Math.min((stage.w - 32) / img.w, (stage.h - 32) / img.h));
  const cssW = Math.max(1, img.w * fit);
  const cssH = Math.max(1, img.h * fit);

  // The render loop reads the latest values from here
  const live = useRef({ params: shown, focus: shownFocus, guide, guidePx: 1, timeline, playing });
  useEffect(() => {
    live.current = { params: shown, focus: shownFocus, guide, guidePx: GUIDE_CSS_PX * (img.w / cssW), timeline, playing };
    dirty.current = true;
  }, [shown, shownFocus, guide, img.w, cssW, timeline, playing]);

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

  // Autosave settings, focus and timeline shortly after they stop changing
  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => saveSession({ params, focus, timeline }), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [params, focus, timeline]);

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
    // Pick up where the last session left off
    const s = loadSession();
    if (s) { setParams(s.params); setFocus(s.focus); setTimeline(s.timeline); }
    restored.current = true;
    // The stored session image, else the bundled default
    loadImage()
      .then(b => b ?? fetch(DEFAULT_IMAGE).then(r => r.ok ? r.blob() : null))
      .then(b => { if (b && !imageChosen.current) showImage(b, false); });

    let raf = 0;
    const loop = (now: number) => {
      const { params: p, focus: f, guide: g, guidePx, timeline: tl, playing: on } = live.current;
      if (recordingRef.current) {
        // the exporter owns the canvas
      } else if (on) {
        // Playback samples the timeline every frame; the UI catches up ~20x a second
        const c = clock.current;
        c.t = (((now - c.origin) / 1000) % tl.duration + tl.duration) % tl.duration;
        const s = sample(tl, c.t);
        engine.render({ ...p, ...s.params }, s.focus ?? f, now, { guide: g, guidePx });
        if (now - c.tick > 50) { c.tick = now; setPlayhead(c.t); }
      } else if (dirty.current || isMoving(p)) {
        engine.render(p, f, now, { guide: g, guidePx });
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
    pickGlyphs(glyphChars(shown), engine.glyphCap, !!shown.fitEach,
      p => { if (!cancelled) setGlyphProgress(p); }, () => cancelled)
      .then(list => {
        if (!list || cancelled) return;
        engine.setGlyphs(list, !!shown.sortInk, !!shown.fitEach);
        dirty.current = true;
        setGlyphProgress(null);
      });
    return () => { cancelled = true; setGlyphProgress(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only these shape the atlas
  }, [shown.chars, shown.charset, shown.sortInk, shown.fitEach]);

  // Stage size
  useEffect(() => {
    const el = stageRef.current!;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Playback
  const pause = () => {
    if (!playing) return;
    setPlaying(false);
    setPlayhead(clock.current.t);
  };
  const togglePlay = () => {
    if (playing) return pause();
    clock.current.origin = performance.now() - playhead * 1000;
    clock.current.t = playhead;
    setPlaying(true);
  };
  const seek = (t: number) => {
    pause();
    setPlayhead(Math.min(timeline.duration, Math.max(0, t)));
  };

  // Edits. An animated property gets a key at the playhead; anything else
  // changes the plain setting, which applies at every time.
  const now = () => (playing ? clock.current.t : playhead);
  const setParam = (id: string, v: Value) => {
    const next = withParam(shown, id, v); // may change linked settings too (charset ↔ chars)
    const changed = Object.keys(next).filter(k => next[k] !== shown[k]);
    const keyed = changed.filter(k => timeline.tracks[k]);
    const plain = changed.filter(k => !timeline.tracks[k]);
    if (keyed.length) {
      const t = now();
      pause();
      setTimeline(tl => keyed.reduce((acc, k) => setKey(acc, k, t, next[k]), tl));
    }
    if (plain.length) setParams(p => ({ ...p, ...Object.fromEntries(plain.map(k => [k, next[k]])) }));
  };
  const editFocus = (f: Focus) => {
    if (timeline.tracks[FOCUS]) {
      const t = now();
      pause();
      setTimeline(tl => setKey(tl, FOCUS, t, clampFocus(f)));
    } else {
      setFocus(clampFocus(f));
    }
  };

  // Apply a timeline change. Tracks it drops stop animating and keep the value
  // they had at the playhead, so the look on screen doesn't jump.
  const commitTimeline = (next: TL) => {
    const gone = Object.keys(timeline.tracks).filter(id => !next.tracks[id]);
    const keepParams = Object.fromEntries(gone.filter(id => id !== FOCUS).map(id => [id, shown[id]]));
    if (Object.keys(keepParams).length) setParams(p => ({ ...p, ...keepParams }));
    if (gone.includes(FOCUS)) setFocus(shownFocus);
    setTimeline(next);
  };

  // The diamond next to each setting
  const keyState = (id: string): KeyState | null => {
    if (!animatable(id)) return null;
    if (!timeline.tracks[id]) return "none";
    return hasKey(timeline, id, playhead) ? "key" : "anim";
  };
  const toggleKey = (id: string) => {
    const t = now();
    pause();
    const value = id === FOCUS ? shownFocus : shown[id];
    commitTimeline(hasKey(timeline, id, t) ? removeKey(timeline, id, t) : setKey(timeline, id, t, value));
  };

  // Dev-only handle for scripted visual checks
  const devApi = useRef({ setParam, editFocus, seek });
  useEffect(() => { devApi.current = { setParam, editFocus, seek }; });
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    (window as unknown as Record<string, unknown>).__dither = {
      setParam: (id: string, v: Value) => devApi.current.setParam(id, v),
      setFocus: (f: Focus) => devApi.current.editFocus(f),
      seek: (t: number) => devApi.current.seek(t),
      glyphs: () => engineRef.current?.glyphCount,
    };
  }, []);

  // Space plays and pauses; read through a ref so the listener stays put
  const togglePlayRef = useRef(togglePlay);
  useEffect(() => { togglePlayRef.current = togglePlay; });

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
      if (t.tagName === "INPUT" && ["text", "number"].includes((t as HTMLInputElement).type)) return;
      if (t.tagName === "SELECT") return;
      if (e.key === "h" || e.key === "H") setParams(p => ({ ...p, guide: !p.guide }));
      if (e.code === "Space" && t.tagName !== "BUTTON") { e.preventDefault(); togglePlayRef.current(); }
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

  const dragFocus = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const r = e.currentTarget.getBoundingClientRect();
    editFocus({ x: d.focus.x + (e.clientX - d.x) / r.width, y: d.focus.y + (e.clientY - d.y) / r.height });
  };
  const focusAtCursor = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    editFocus({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };

  const currentPreset = (): Preset => ({
    params: presetParams(shown), focus: shownFocus,
    ...(Object.keys(timeline.tracks).length ? { timeline } : {}),
  });
  const applyPreset = (p: Partial<Preset>) => {
    // Keep the current view settings (guide, field view); take everything else from the preset
    setParams(cur => ({ ...sanitizeParams(p.params), guide: cur.guide, showField: cur.showField }));
    const f = p.focus;
    if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) setFocus(clampFocus(f));
    setTimeline(sanitizeTimeline(p.timeline));
    setPlaying(false);
    setPlayhead(0);
  };

  // Video: the timeline's length when it animates, otherwise a fixed clip of
  // the noise/scramble/drift motion
  const animated = isAnimated(timeline);
  const moving = isMoving(shown);
  const videoSeconds = animated ? timeline.duration : VIDEO_SECONDS;

  const exportMp4 = async () => {
    const engine = engineRef.current, canvas = canvasRef.current;
    if (!engine || !canvas || recordingRef.current) return;
    pause();
    recordingRef.current = true;
    setRecording(0);
    try {
      const tl = timeline, base = shown, f = shownFocus;
      const blob = await recordMp4(canvas, ms => {
        const s = sample(tl, ms / 1000);
        engine.render({ ...base, ...s.params }, s.focus ?? f, ms, { guide: false, guidePx: 1 });
      }, setRecording, videoSeconds);
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
    engine.render(shown, shownFocus, performance.now(), { guide: false, guidePx: 1 });
    const blob = await engine.toBlob();
    dirty.current = true;
    if (blob) download(blob, "focal-dither.png");
  };

  return (
    <div className="app">
      <div className="main">
      <main className="stage" ref={stageRef}>
        {error ? (
          <div className="err">{error}</div>
        ) : (
          <div className="frame" style={{ width: cssW, height: cssH }}>
            <canvas
              ref={canvasRef}
              className={fit >= 1 ? "up" : undefined}
              onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, focus: shownFocus }; e.currentTarget.setPointerCapture(e.pointerId); }}
              onPointerMove={dragFocus}
              onPointerUp={() => { drag.current = null; }}
              onPointerCancel={() => { drag.current = null; }}
              onDoubleClick={focusAtCursor}
            />
            {guide && <div className="marker" style={{ left: `${shownFocus.x * 100}%`, top: `${shownFocus.y * 100}%` }} />}
          </div>
        )}
        {dragOver && <div className="drop">Drop image</div>}
        {guide && <div className="hint">drag to move focus · double-click to center it there · H toggles guide · space plays · drop / paste an image</div>}
      </main>
      <Timeline
        timeline={timeline}
        playhead={playhead}
        playing={playing}
        onSeek={seek}
        onTogglePlay={togglePlay}
        label={id => (id === FOCUS ? "Focus" : LABELS.get(id) ?? id)}
        onToggleKey={toggleKey}
        onMoveKey={(id, from, to) => {
          setTimeline(tl => moveKey(tl, id, from, to));
          setPlayhead(Math.min(timeline.duration, Math.max(0, to)));
        }}
        onRemoveKey={(id, t) => { pause(); commitTimeline(removeKey(timeline, id, t)); }}
        onRemoveTrack={id => { pause(); commitTimeline(removeTrack(timeline, id)); }}
        onDuration={d => { pause(); const tl = setDuration(timeline, d); setTimeline(tl); setPlayhead(p => Math.min(p, tl.duration)); }}
        onEase={(e: Ease) => setTimeline(tl => ({ ...tl, ease: e }))}
        onClear={() => { pause(); commitTimeline({ ...timeline, tracks: {} }); }}
      />
      </div>
      <aside>
        <h1>Focal <span>Dither</span></h1>
        <div className="btns">
          <label className="btn">Upload<input type="file" accept="image/*" onChange={e => { loadFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
          <button className="btn" onClick={exportPng}>Export PNG</button>
        </div>
        <div className="btns">
          <button className="btn" onClick={exportMp4} disabled={recording !== null || !(moving || animated)}
            title={animated ? `Render the ${videoSeconds}s timeline` : moving ? `Render ${videoSeconds}s of the animation`
              : "Nothing moves: add keyframes, or turn on Animate with Drift, Noise or ASCII scramble"}>
            {recording === null ? `Export MP4 · ${videoSeconds}s` : `Rendering video… ${Math.round(recording * 100)}%`}
          </button>
        </div>
        <div className="btns">
          <button className="btn" onClick={() => editFocus({ x: 0.5, y: 0.5 })}>Center</button>
          <button className="btn" title="Default settings, no keyframes (keeps the image)" onClick={() => {
            setParams(p => ({ ...defaultParams(), guide: p.guide }));
            setFocus(DEFAULT_FOCUS);
            setTimeline(tl => ({ ...emptyTimeline(), duration: tl.duration }));
            setPlaying(false);
            setPlayhead(0);
          }}>Reset</button>
        </div>
        {glyphProgress !== null && <div className="status">Measuring Unicode glyphs… {Math.round(glyphProgress * 100)}%</div>}
        <Presets current={currentPreset} apply={applyPreset} />
        <Controls params={shown} setParam={setParam} keyState={keyState} onKey={toggleKey} />
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
