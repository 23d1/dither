import { unicodeChars } from "./unicode";

export type Value = number | boolean | string;
export type Params = Record<string, Value>;

export type Row = {
  id: string;
  label: string;
  type?: "range" | "check" | "select" | "text" | "color";
  min?: number;
  max?: number;
  step?: number;
  val: Value;
  options?: [string, number][];
  fmt?: (v: number) => string;
  placeholder?: string;
};
export type Group = { title: string; toggle?: string; on?: boolean; rows: Row[] };

// Ramps go roughly full -> limited. "Sort by ink" re-orders any set light->dense.
export const CHARSETS: [string, string][] = [
  ["Full · 70", " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$"],
  ["23d vocab", " 01:=+*#%@$&XY<>/\\[]{}─━│┃░▒▓ABCDEF·"],
  ["Standard · 10", " .:-=+*#%@"],
  ["Hex", " 0123456789ABCDEF"],
  ["Letters", " ilcoaenmwBMW"],
  ["Braille", " ⠁⠃⠇⠏⠟⠿⡿⣿"],
  ["Box lines", " ·─│┼━┃╋"],
  ["Shade blocks", " ░▒▓█"],
  ["Dots", " ·•●"],
  ["Minimal · 4", " .:#"],
  ["Binary", " 01"],
  ["Unicode · all", ""], // generated: see unicode.ts / glyphChars()
];
// Index of the generated set. It's appended so saved presets keep their indices,
// but listed first in the dropdown as the fullest set.
export const UNICODE_SET = CHARSETS.length - 1;
export const SHAPES = ["Circle", "Square", "Rounded", "Diamond", "Hexagon", "Star", "Cross", "Ring", "Band"];

const px = (v: number) => `${v}px`;

export const GROUPS: Group[] = [
  { title: "Global", rows: [
    { id: "guide",     label: "Guide (H)",  type: "check", val: false },
    { id: "scale",     label: "Scale",      min: 0.1, max: 4, step: 0.01, val: 1, fmt: v => v.toFixed(2) + "×" },
    { id: "animate",   label: "Animate",    type: "check", val: true },
    { id: "drift",     label: "Drift",      val: 0.56 },
    { id: "showField", label: "Show field", type: "check", val: false },
  ]},
  { title: "Shape", rows: [
    { id: "shape",    label: "Shape",    type: "select", options: SHAPES.map((s, i) => [s, i]), val: 0 },
    { id: "radius",   label: "Radius",   min: 0.02, max: 1.5, step: 0.01, val: 0.3 },
    { id: "falloff",  label: "Falloff",  min: 0.2, max: 4, step: 0.01, val: 1 },
    { id: "aspect",   label: "Aspect",   min: -2, max: 2, step: 0.01, val: 0, fmt: v => (2 ** v).toFixed(2) },
    { id: "rotation", label: "Rotation", min: 0, max: 180, step: 1, val: 0, fmt: v => v + "°" },
  ]},
  // Off = the area follows the shape strictly. Amount blends toward the full noise settings.
  { title: "Organic", toggle: "organicOn", rows: [
    { id: "organic",    label: "Amount",      val: 1 },
    { id: "warp",       label: "Irregular",   val: 0.25 },
    { id: "warpScale",  label: "Irreg. size", min: 0.1, max: 4, step: 0.01, val: 1 },
    { id: "reach",      label: "Reach",       min: 0, max: 4, step: 0.01, val: 1.2, fmt: v => v.toFixed(2) + "r" },
    { id: "islands",    label: "Islands",     val: 0.4 },
    { id: "islandAmt",  label: "Island str.", val: 1 },
    { id: "islandSize", label: "Island size", min: 4, max: 400, step: 1, val: 56, fmt: px },
    { id: "holes",      label: "Holes",       val: 0.15 },
    { id: "seed",       label: "Seed",        min: 0, max: 100, step: 1, val: 7, fmt: String },
  ]},
  { title: "Squares", toggle: "pixOn", rows: [
    { id: "pix",     label: "Amount",   val: 1 },
    { id: "maxCell", label: "Max size", min: 1, max: 12, step: 0.01, val: 7, fmt: v => px(Math.round(2 ** v)) },
    { id: "minCell", label: "Min size", min: 1, max: 64, step: 1, val: 2, fmt: px },
    { id: "scatter", label: "Scatter",  val: 0.4 },
    // In size bands: 1 = squares sample up to one band (where one square size wins) away
    { id: "spreadBands", label: "Spread", min: 0, max: 3, step: 0.01, val: 1, fmt: v => v.toFixed(2) },
  ]},
  { title: "Blur", toggle: "blurOn", rows: [
    { id: "blur",    label: "Amount", val: 0.35 },
    { id: "blurMax", label: "Max px", min: 1, max: 64, step: 1, val: 24, fmt: String },
  ]},
  { title: "Noise", toggle: "noiseOn", rows: [
    { id: "noise", label: "Amount", val: 0.2 },
  ]},
  { title: "Dither", toggle: "ditherOn", rows: [
    { id: "dither",  label: "Amount", val: 0.5 },
    { id: "dLevels", label: "Levels", min: 2, max: 16, step: 1, val: 4, fmt: String },
    { id: "mono",    label: "Mono",   val: 0 },
  ]},
  { title: "ASCII", toggle: "asciiOn", rows: [
    { id: "ascii",    label: "Amount",      val: 1 },
    { id: "charset",  label: "Set",         type: "select", options: [[CHARSETS[UNICODE_SET][0], UNICODE_SET], ...CHARSETS.slice(0, UNICODE_SET).map((c, i): [string, number] => [c[0], i]), ["Custom", -1]], val: 7 },
    { id: "chars",    label: "Chars",       type: "text", val: CHARSETS[7][1], placeholder: "all of Unicode · type your own" },
    { id: "sortInk",  label: "Sort by ink", type: "check", val: true },
    { id: "fitEach",  label: "Fit each",    type: "check", val: true },
    { id: "invert",   label: "Dark=dense",  type: "check", val: false },
    { id: "plain",    label: "Plain ratio", val: 0.5 },
    { id: "contrast", label: "Contrast",    val: 0.5 },
    { id: "sat",      label: "Saturation",  min: 0, max: 3, step: 0.01, val: 1.6 },
    { id: "scramble", label: "Scramble",    val: 0.3 },
    { id: "scrSpeed", label: "Scr. speed",  min: 0.5, max: 30, step: 0.5, val: 5, fmt: v => v + "/s" },
    { id: "glyphMin", label: "Min glyph",   min: 2, max: 48, step: 1, val: 8, fmt: px },
  ]},
  // Everything the effect doesn't reach becomes a flat colour; partly affected
  // areas blend into it with their strength, so edges keep their falloff and scatter
  { title: "Outside", toggle: "solidOn", on: false, rows: [
    { id: "solid",      label: "Amount", val: 1 },
    { id: "solidColor", label: "Color",  type: "color", val: "#000000" },
  ]},
];

// View-only settings that presets don't carry
export const VIEW_KEYS = ["guide", "showField"];

export function defaultParams(): Params {
  const p: Params = {};
  for (const g of GROUPS) {
    if (g.toggle) p[g.toggle] = g.on !== false;
    for (const r of g.rows) p[r.id] = r.val;
  }
  return p;
}

// Keep only known keys whose type matches the default, so old or hand-edited
// presets can't break the shader. Missing keys fall back to defaults.
// Sliders, to clamp loaded values into their range (and to interpolate on the timeline)
export const RANGES = new Map(GROUPS.flatMap(g => g.rows).filter(r => !r.type || r.type === "range").map(r => [r.id, r]));

export function sanitizeParams(input: unknown): Params {
  const out = defaultParams();
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (k in out && !VIEW_KEYS.includes(k) && typeof v === typeof out[k] && (typeof v !== "number" || Number.isFinite(v))) {
      const row = RANGES.get(k);
      out[k] = row && typeof v === "number" ? Math.min(row.max ?? 1, Math.max(row.min ?? 0, v)) : (v as Value);
    }
  }
  return out;
}

export function presetParams(p: Params): Params {
  const out = { ...p };
  for (const k of VIEW_KEYS) delete out[k];
  return out;
}

// The characters the ASCII atlas is built from
export function glyphChars(p: Params): string {
  return Number(p.charset) === UNICODE_SET ? unicodeChars() : String(p.chars);
}

// One control change. The charset dropdown and the chars field stay in sync:
// picking a set fills the field, typing switches the dropdown to Custom.
export function withParam(p: Params, id: string, v: Value): Params {
  const next = { ...p, [id]: v };
  if (id === "charset" && Number(v) >= 0) next.chars = CHARSETS[Number(v)][1];
  if (id === "chars") next.charset = CHARSETS.findIndex((c, i) => i !== UNICODE_SET && c[1] === v);
  return next;
}
