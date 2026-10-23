"use client";

// After Effects-style timeline: a toolbar, a ruler to scrub on, and one row per
// animated property with its own keyframes. The playhead runs through every row.
import { useRef } from "react";
import { FOCUS, MAX_DURATION, MIN_DURATION, type Ease, type Timeline as TL } from "@/lib/timeline";
import KeyButton from "./KeyButton";

type Props = {
  timeline: TL;
  playhead: number;
  playing: boolean;
  label: (id: string) => string;
  onSeek: (t: number) => void;
  onTogglePlay: () => void;
  onToggleKey: (id: string) => void;
  onMoveKey: (id: string, from: number, to: number) => void;
  onRemoveKey: (id: string, t: number) => void;
  onRemoveTrack: (id: string) => void;
  onDuration: (d: number) => void;
  onEase: (e: Ease) => void;
  onClear: () => void;
};

const SNAP = 1 / 60;

export default function Timeline(p: Props) {
  const { timeline: tl, playhead } = p;
  const ruler = useRef<HTMLDivElement>(null);
  // A drag on the ruler or an empty lane scrubs; a drag on a key moves that key
  const drag = useRef<{ id: string; from: number } | "scrub" | null>(null);
  const ids = Object.keys(tl.tracks);
  const pct = (t: number) => `${(t / tl.duration) * 100}%`;

  // Every lane lines up with the ruler, so its box converts x to time
  const timeAt = (clientX: number) => {
    const r = ruler.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * tl.duration;
  };
  const scrubStart = (e: React.PointerEvent) => {
    drag.current = "scrub";
    e.currentTarget.setPointerCapture(e.pointerId);
    p.onSeek(timeAt(e.clientX));
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const t = timeAt(e.clientX);
    if (d === "scrub") return p.onSeek(t);
    p.onMoveKey(d.id, d.from, t);
    d.from = t;
  };
  const end = () => { drag.current = null; };
  const laneEvents = { onPointerDown: scrubStart, onPointerMove: onMove, onPointerUp: end, onPointerCancel: end };

  // Ruler ticks: every second, or every 5 for long timelines
  const step = tl.duration > 20 ? 5 : 1;
  const ticks = Array.from({ length: Math.floor(tl.duration / step) + 1 }, (_, i) => i * step);

  const jump = (id: string, dir: -1 | 1) => {
    const ts = tl.tracks[id].map(k => k.t);
    const t = dir < 0 ? ts.filter(x => x < playhead - SNAP).pop() : ts.find(x => x > playhead + SNAP);
    if (t !== undefined) p.onSeek(t);
  };

  return (
    <div className="timeline">
      <div className="tl-bar">
        <button className="btn tl-play" onClick={p.onTogglePlay} title="Play / pause (Space)">{p.playing ? "❚❚" : "▶"}</button>
        <span className="tl-time">{playhead.toFixed(2)}s</span>
        <span className="tl-spacer" />
        {!tl.tracks[FOCUS] && (
          <button className="btn" onClick={() => p.onToggleKey(FOCUS)} title="Animate the focus point">◇ Animate focus</button>
        )}
        <label className="tl-field" title="Length in seconds">
          <input type="number" min={MIN_DURATION} max={MAX_DURATION} step={0.5} value={tl.duration}
            onChange={e => { const d = Number(e.target.value); if (Number.isFinite(d) && d > 0) p.onDuration(d); }} />s
        </label>
        <select value={tl.ease} onChange={e => p.onEase(e.target.value as Ease)} title="How values move between keys">
          <option value="smooth">Ease</option>
          <option value="linear">Linear</option>
        </select>
        <button className="btn" onClick={p.onClear} disabled={!ids.length} title="Stop animating everything (keeps the current look)">Clear</button>
      </div>

      <div className="tl-grid">
        <div className="tl-row tl-ruler-row">
          <div className="tl-label" />
          <div ref={ruler} className="tl-lane tl-ruler" {...laneEvents}>
            {ticks.map(t => <span key={t} className="tl-tick" style={{ left: pct(t) }}>{t}s</span>)}
          </div>
        </div>

        {ids.length === 0 && (
          <div className="tl-row">
            <div className="tl-label tl-empty">Click ◇ next to any setting to animate it</div>
            <div className="tl-lane" {...laneEvents} />
          </div>
        )}

        {ids.map(id => {
          const keys = tl.tracks[id];
          const here = keys.some(k => Math.abs(k.t - playhead) < SNAP);
          return (
            <div className="tl-row" key={id}>
              <div className="tl-label">
                <button className="tl-nav" onClick={() => jump(id, -1)} title="Previous key">◀</button>
                <KeyButton state={here ? "key" : "anim"} onClick={() => p.onToggleKey(id)} label={p.label(id)} />
                <button className="tl-nav" onClick={() => jump(id, 1)} title="Next key">▶</button>
                <span className="tl-name">{p.label(id)}</span>
                <button className="tl-nav tl-x" onClick={() => p.onRemoveTrack(id)} title="Stop animating (keeps the current value)">✕</button>
              </div>
              <div className="tl-lane" {...laneEvents}>
                {keys.map(k => (
                  <i
                    key={k.t}
                    className={`tl-key${Math.abs(k.t - playhead) < SNAP ? " on" : ""}`}
                    style={{ left: pct(k.t) }}
                    title={`${p.label(id)} at ${k.t.toFixed(2)}s · drag to move · Alt-click to delete`}
                    onPointerDown={e => {
                      e.stopPropagation();
                      if (e.altKey) return p.onRemoveKey(id, k.t);
                      drag.current = { id, from: k.t };
                      e.currentTarget.parentElement!.setPointerCapture(e.pointerId);
                      p.onSeek(k.t);
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}

        <div className="tl-headwrap"><b className="tl-head" style={{ left: pct(playhead) }} /></div>
      </div>
    </div>
  );
}
