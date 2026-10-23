// Keyframe animation, per property (like After Effects' stopwatch). Nothing is
// animated until you key it: a property with a track takes its value from its
// keyframes at the playhead; every other setting stays global and applies at all
// times. Sliders, the focus and colours blend between keys; switches, dropdowns
// and text hold until the next key.
import type { Focus } from "./engine";
import { RANGES, VIEW_KEYS, defaultParams, type Params, type Value } from "./params";

export type Ease = "smooth" | "linear";
export type Key = { t: number; v: Value | Focus };
export type Timeline = { duration: number; ease: Ease; tracks: Record<string, Key[]> };
export type Sample = { params: Params; focus?: Focus };

export const FOCUS = "focus";
export const MIN_DURATION = 0.5;
export const MAX_DURATION = 60;
const SNAP = 1 / 60; // keys closer than one frame are at the same time

// The charset dropdown and chars field drive each other and rebuild the glyph
// atlas, so they stay global; view settings never animate
const FIXED = ["chars", "charset"];
export const animatable = (id: string) => id === FOCUS || (!VIEW_KEYS.includes(id) && !FIXED.includes(id));

export const emptyTimeline = (): Timeline => ({ duration: 5, ease: "smooth", tracks: {} });

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const clampFocus = (f: Focus): Focus => ({ x: clamp(f.x, 0, 1), y: clamp(f.y, 0, 1) });
const same = (a: number, b: number) => Math.abs(a - b) < SNAP;
const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

function blend(id: string, a: Value | Focus, b: Value | Focus, u: number): Value | Focus {
  if (typeof a === "object" && typeof b === "object") return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  if (typeof a === "number" && typeof b === "number" && RANGES.has(id)) {
    const v = a + (b - a) * u;
    return (RANGES.get(id)!.step ?? 0.01) >= 1 ? Math.round(v) : v;
  }
  if (isHex(a) && isHex(b)) {
    const ch = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16);
    return "#" + [1, 3, 5].map(i => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * u).toString(16).padStart(2, "0")).join("");
  }
  return a; // switches, dropdowns, text: hold until the next key
}

function sampleTrack(id: string, keys: Key[], t: number, ease: Ease): Value | Focus {
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  const i = keys.findIndex(k => k.t > t);
  const a = keys[i - 1], b = keys[i];
  let u = (t - a.t) / (b.t - a.t);
  if (ease === "smooth") u = u * u * (3 - 2 * u);
  return blend(id, a.v, b.v, u);
}

// The animated values at t (only the properties that have tracks)
export function sample(tl: Timeline, t: number): Sample {
  const out: Sample = { params: {} };
  for (const [id, keys] of Object.entries(tl.tracks)) {
    if (!keys.length) continue;
    const v = sampleTrack(id, keys, t, tl.ease);
    if (id === FOCUS) out.focus = v as Focus;
    else out.params[id] = v as Value;
  }
  return out;
}

export const hasKey = (tl: Timeline, id: string, t: number) => !!tl.tracks[id]?.some(k => same(k.t, t));

// Write a key for one property at t, replacing one already there
export function setKey(tl: Timeline, id: string, t: number, v: Value | Focus): Timeline {
  const key = { t: clamp(t, 0, tl.duration), v };
  const keys = (tl.tracks[id] ?? []).filter(k => !same(k.t, key.t));
  return { ...tl, tracks: { ...tl.tracks, [id]: [...keys, key].sort((a, b) => a.t - b.t) } };
}

// Remove one property's key at t; a track left without keys stops animating
export function removeKey(tl: Timeline, id: string, t: number): Timeline {
  const keys = (tl.tracks[id] ?? []).filter(k => !same(k.t, t));
  const tracks = { ...tl.tracks };
  if (keys.length) tracks[id] = keys;
  else delete tracks[id];
  return { ...tl, tracks };
}

// Move one property's key from `from` to `to` (replacing any key already there)
export function moveKey(tl: Timeline, id: string, from: number, to: number): Timeline {
  const keys = tl.tracks[id];
  const moving = keys?.find(k => same(k.t, from));
  if (!moving) return tl;
  to = clamp(to, 0, tl.duration);
  const rest = keys.filter(k => k !== moving && !same(k.t, to));
  return { ...tl, tracks: { ...tl.tracks, [id]: [...rest, { ...moving, t: to }].sort((a, b) => a.t - b.t) } };
}

export function removeTrack(tl: Timeline, id: string): Timeline {
  const tracks = { ...tl.tracks };
  delete tracks[id];
  return { ...tl, tracks };
}

// Every time that has a key on any track
export function keyTimes(tl: Timeline): number[] {
  const ts = Object.values(tl.tracks).flat().map(k => k.t).sort((a, b) => a - b);
  return ts.filter((t, i) => i === 0 || !same(t, ts[i - 1]));
}

// Move every key at `from` to `to` (a marker on the bar moves all keys under it)
export function moveTime(tl: Timeline, from: number, to: number): Timeline {
  to = clamp(to, 0, tl.duration);
  const tracks: Timeline["tracks"] = {};
  for (const [id, keys] of Object.entries(tl.tracks)) {
    const moving = keys.find(k => same(k.t, from));
    tracks[id] = moving
      ? [...keys.filter(k => !same(k.t, from) && !same(k.t, to)), { ...moving, t: to }].sort((a, b) => a.t - b.t)
      : keys;
  }
  return { ...tl, tracks };
}

export function removeTime(tl: Timeline, t: number): Timeline {
  return Object.keys(tl.tracks).reduce((acc, id) => removeKey(acc, id, t), tl);
}

export function setDuration(tl: Timeline, d: number): Timeline {
  const duration = clamp(d, MIN_DURATION, MAX_DURATION);
  const tracks: Timeline["tracks"] = {};
  // Keys past the new end are pulled in to it (the last one there wins)
  for (const [id, keys] of Object.entries(tl.tracks)) {
    const pulled = keys.map(k => ({ ...k, t: Math.min(k.t, duration) }));
    tracks[id] = pulled.filter((k, i) => !pulled.slice(i + 1).some(o => same(o.t, k.t)));
  }
  return { ...tl, duration, tracks };
}

// Does anything actually change over time?
export const isAnimated = (tl: Timeline) => Object.values(tl.tracks).some(keys => keys.length > 1);

// Loaded timelines (session, presets, JSON) can be old or hand-edited. Timelines
// from the earlier whole-snapshot format have no tracks and load empty.
export function sanitizeTimeline(input: unknown): Timeline {
  const tl = emptyTimeline();
  if (!input || typeof input !== "object") return tl;
  const d = input as Record<string, unknown>;
  if (typeof d.duration === "number" && Number.isFinite(d.duration)) tl.duration = clamp(d.duration, MIN_DURATION, MAX_DURATION);
  if (d.ease === "linear" || d.ease === "smooth") tl.ease = d.ease;
  if (!d.tracks || typeof d.tracks !== "object") return tl;
  const defaults = defaultParams();
  for (const [id, keys] of Object.entries(d.tracks as Record<string, unknown>)) {
    if (!animatable(id) || (id !== FOCUS && !(id in defaults)) || !Array.isArray(keys)) continue;
    const ok: Key[] = [];
    for (const k of keys) {
      if (!k || typeof k.t !== "number" || !Number.isFinite(k.t)) continue;
      const t = clamp(k.t, 0, tl.duration);
      if (id === FOCUS) {
        if (k.v && Number.isFinite(k.v.x) && Number.isFinite(k.v.y)) ok.push({ t, v: clampFocus(k.v) });
      } else if (typeof k.v === typeof defaults[id] && (typeof k.v !== "number" || Number.isFinite(k.v))) {
        const row = RANGES.get(id);
        ok.push({ t, v: row && typeof k.v === "number" ? clamp(k.v, row.min ?? 0, row.max ?? 1) : k.v });
      }
    }
    if (ok.length) tl.tracks[id] = ok.sort((a, b) => a.t - b.t);
  }
  return tl;
}
