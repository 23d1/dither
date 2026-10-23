"use client";

import { GROUPS, type Params, type Row, type Value } from "@/lib/params";

type Props = { params: Params; setParam: (id: string, v: Value) => void };

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

export default function Controls({ params, setParam }: Props) {
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
            {g.rows.map(r => (
              <div className="row" key={r.id}>
                <label htmlFor={`c_${r.id}`}>{r.label}</label>
                <Control row={r} value={params[r.id]} set={v => setParam(r.id, v)} />
              </div>
            ))}
          </section>
        );
      })}
    </>
  );
}
