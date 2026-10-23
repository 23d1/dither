// Chooses the glyphs that go into the atlas. Small sets pass straight through.
// A set bigger than the texture array (e.g. all of Unicode) is surveyed: every
// glyph is drawn small, many per canvas, its ink (and ink box, for fitted
// glyphs) read from the pixels, and `cap` glyphs are kept spaced evenly from
// lightest to densest so the whole tonal range survives. The survey runs in
// chunks so the page stays responsive, and its result is cached per browser.

export const GLYPH_FONT = '"SFMono-Regular", Menlo, Consolas, monospace';
const CACHE = "focal-dither:glyphs:v2:";

export async function pickGlyphs(
  chars: string,
  cap: number,
  fitEach: boolean,
  onProgress: (done: number) => void,
  cancelled: () => boolean,
): Promise<string[] | null> {
  let list = [...new Set([...(chars || " ")])];
  if (list.length <= cap) return list;

  let h = 5381;
  for (const ch of list) h = (h * 33 + ch.codePointAt(0)!) | 0;
  const key = `${CACHE}${cap}:${fitEach ? 1 : 0}:${list.length}:${h}`;
  try {
    const hit = localStorage.getItem(key);
    if (hit) return [...hit];
  } catch { /* storage blocked */ }

  // Unassigned code points draw the "missing glyph" box; any glyph that draws
  // the identical bitmap has no font here and is dropped
  const PROBES = ["\u0378", "\uFDD0"];
  list = [...list, ...PROBES];
  const sig: string[] = new Array(list.length);

  const P = 32, COLS = 64, PER = COLS * COLS;
  const c = document.createElement("canvas");
  c.width = c.height = COLS * P;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.textAlign = "center";
  x.textBaseline = "middle";
  const ink = new Float64Array(list.length);

  for (let start = 0; start < list.length; start += PER) {
    onProgress(start / list.length);
    await new Promise(r => setTimeout(r)); // let the page breathe between chunks
    if (cancelled()) return null;

    x.fillStyle = "#000";
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = "#fff";
    x.font = `${P * 0.45}px ${GLYPH_FONT}`;
    const n = Math.min(PER, list.length - start);
    for (let j = 0; j < n; j++) x.fillText(list[start + j], ((j % COLS) + 0.5) * P, (Math.floor(j / COLS) + 0.5) * P);

    // Per cell: total ink, and the box of pixels with ink in them
    const px = x.getImageData(0, 0, c.width, c.height).data;
    const sum = new Float64Array(n);
    const box = new Int32Array(n * 4).fill(-1); // x0, y0, x1, y1
    for (let y = 0; y < c.height; y++) {
      for (let xx = 0; xx < c.width; xx++) {
        const v = px[(y * c.width + xx) * 4];
        if (!v) continue;
        const cell = Math.floor(y / P) * COLS + Math.floor(xx / P);
        if (cell >= n) continue;
        sum[cell] += v;
        if (v < 64) continue;
        const b = cell * 4, cx = xx % P, cy = y % P;
        if (box[b] < 0) { box[b] = box[b + 2] = cx; box[b + 1] = box[b + 3] = cy; }
        else {
          box[b] = Math.min(box[b], cx); box[b + 2] = Math.max(box[b + 2], cx);
          box[b + 1] = Math.min(box[b + 1], cy); box[b + 3] = Math.max(box[b + 3], cy);
        }
      }
    }
    for (let j = 0; j < n; j++) {
      // A fitted glyph is scaled until its ink box fills the square, which
      // scales its ink by the square of that factor
      const b = j * 4, size = Math.max(box[b + 2] - box[b], box[b + 3] - box[b + 1]) + 1;
      ink[start + j] = fitEach && box[b] >= 0 ? sum[j] * (P / size) ** 2 : sum[j];
      sig[start + j] = `${sum[j]},${box[b + 2] - box[b]},${box[b + 3] - box[b + 1]}`;
    }
  }
  onProgress(1);

  const tofu = new Set(PROBES.map((_, i) => sig[list.length - PROBES.length + i]).filter(t => !t.startsWith("0,")));
  const order = list.map((_, i) => i)
    .filter(i => i < list.length - PROBES.length && !tofu.has(sig[i]))
    .sort((a, b) => ink[a] - ink[b]);
  const keep = new Set<number>();
  for (let j = 0; j < cap; j++) keep.add(order[Math.round((j * (order.length - 1)) / (cap - 1))]);
  list = [...keep].map(i => list[i]);
  try { localStorage.setItem(key, list.join("")); } catch { /* full or blocked */ }
  return list;
}
