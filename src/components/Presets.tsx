"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { Focus } from "@/lib/engine";
import type { Params } from "@/lib/params";
import { DEFAULT_FOCUS, type Timeline } from "@/lib/timeline";

// timeline is optional: presets saved before the timeline existed have none
export type Preset = { params: Params; focus: Focus; timeline?: Timeline };
type Store = Record<string, Preset>;

const KEY = "focal-dither:presets";
const CHANGE = "focal-dither:presets-change";

// localStorage as an external store, so the list stays in sync across tabs
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(CHANGE, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(CHANGE, cb);
  };
}
function snapshot() {
  try { return localStorage.getItem(KEY) ?? "{}"; } catch { return "{}"; }
}
function parse(raw: string): Store {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}
function write(store: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    window.dispatchEvent(new Event(CHANGE));
    return true;
  } catch {
    alert("Could not save to this browser's storage. Use Export JSON instead.");
    return false;
  }
}

type Props = { current: () => Preset; apply: (p: Partial<Preset>) => void };

export default function Presets({ current, apply }: Props) {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "{}");
  const store = useMemo(() => parse(raw), [raw]);
  const names = Object.keys(store).sort((a, b) => a.localeCompare(b));
  const [name, setName] = useState("");
  const [picked, setPicked] = useState("");
  const selected = names.includes(picked) ? picked : names[0] ?? "";

  const save = () => {
    const n = name.trim() || selected;
    if (!n) return;
    if (store[n] && !confirm(`Replace the preset "${n}"?`)) return;
    if (write({ ...store, [n]: current() })) { setPicked(n); setName(""); }
  };
  const remove = () => {
    if (!selected || !confirm(`Delete the preset "${selected}"?`)) return;
    const next = { ...store };
    delete next[selected];
    write(next);
  };
  const exportJson = () => {
    const n = name.trim() || selected || "focal-dither";
    const blob = new Blob([JSON.stringify({ app: "focal-dither", version: 1, name: n, ...current() }, null, 2)],
      { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${n.replace(/[^\w-]+/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importJson = async (file?: File) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data.params !== "object") throw new Error("missing params");
      const preset: Preset = { params: data.params, focus: data.focus ?? DEFAULT_FOCUS, timeline: data.timeline };
      apply(preset);
      const n = typeof data.name === "string" && data.name.trim() ? data.name.trim() : file.name.replace(/\.json$/i, "");
      if (write({ ...store, [n]: preset })) setPicked(n);
    } catch {
      alert("That file isn't a Focal Dither preset.");
    }
  };

  return (
    <section className="presets">
      <header>Presets</header>
      <div className="row">
        <label htmlFor="preset-pick">Saved</label>
        <select id="preset-pick" value={selected} disabled={!names.length} onChange={e => setPicked(e.target.value)}>
          {names.length ? names.map(n => <option key={n} value={n}>{n}</option>) : <option value="">none yet</option>}
        </select>
      </div>
      <div className="btns">
        <button className="btn" disabled={!selected} onClick={() => apply(store[selected])}>Load</button>
        <button className="btn" disabled={!selected} onClick={remove}>Delete</button>
      </div>
      <div className="row">
        <label htmlFor="preset-name">Name</label>
        <input id="preset-name" type="text" placeholder={selected || "my preset"} value={name}
          onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} />
      </div>
      <div className="btns">
        <button className="btn" onClick={save}>Save</button>
        <button className="btn" onClick={exportJson} title="Download as JSON">Export</button>
        <label className="btn" title="Load a JSON preset">Import<input type="file" accept="application/json,.json"
          onChange={e => { importJson(e.target.files?.[0]); e.target.value = ""; }} /></label>
      </div>
    </section>
  );
}
