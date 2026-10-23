"use client";

import { GROUPS, type Params, type Row, type Value } from "@/lib/params";
import KeyButton, { type KeyState } from "./KeyButton";

type Props = {
  params: Params;
  setParam: (id: string, v: Value) => void;
  // Keyframing: a row's diamond state, or null for rows that can't animate
  keyState: (id: string) => KeyState | null;
  onKey: (id: string) => void;
};

function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label?: string; id?: string }) {
  return (
    <label className="sw">
      <input id={id} type="checkbox" checked={checked} aria-label={label} onChange={e => onChange(e.target.checked)} />
      <i />
    </label>
  );
}

function Control({ row, value, set }: { row: Row; value: Value; set: (v: Value) => void }) {
  const id = `c_${row.id}`;
  if (row.type === "check") return <Switch id={id} checked={!!value} onChange={set} />;
  if (row.type === "select")
    return (
      <select id={id} value={Number(value)} onChange={e => set(Number(e.target.value))}>
        {row.options!.map(([label, v]) => <option key={v} value={v}>{label}</option>)}
      </select>
    );
  if (row.type === "color")
    return <input id={id} type="color" value={String(value)} onChange={e => set(e.target.value)} />;
  if (row.type === "text")
    return <input id={id} type="text" spellCheck={false} value={String(value)} placeholder={row.placeholder} onChange={e => set(e.target.value)} />;
  const v = Number(value);
  const fmt = row.fmt ?? ((x: number) => x.toFixed(2));
  return (
    <>
      <input id={id} type="range" min={row.min ?? 0} max={row.max ?? 1} step={row.step ?? 0.01} value={v}
        onChange={e => set(Number(e.target.value))} />
      <output htmlFor={id}>{fmt(v)}</output>
    </>
  );
}

export default function Controls({ params, setParam, keyState, onKey }: Props) {
  return (
    <>
      {GROUPS.map(g => {
        const enabled = g.toggle ? !!params[g.toggle] : true;
        return (
          <section key={g.title} className={enabled ? undefined : "off"}>
            <header>
              {g.title}
              {g.toggle && <Switch checked={enabled} label={`${g.title} on/off`} onChange={v => setParam(g.toggle!, v)} />}
            </header>
            {g.rows.map(r => {
              const ks = keyState(r.id);
              return (
              <div className="row" key={r.id}>
                <span className="lbl">
                  {ks ? <KeyButton state={ks} onClick={() => onKey(r.id)} label={r.label} /> : <span className="kf-gap" />}
                  <label htmlFor={`c_${r.id}`}>{r.label}</label>
                </span>
                <Control row={r} value={params[r.id]} set={v => setParam(r.id, v)} />
              </div>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
