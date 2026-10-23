import { FRAG, VERT } from "./shaders";
import type { Params } from "./params";
import { GLYPH_FONT } from "./glyphs";

export type Focus = { x: number; y: number };
export type RenderOpts = { guide: boolean; guidePx: number };

const MAX_IMAGE = 4096;
const GLYPH_PX = 128; // glyph raster size; mipmaps cover smaller squares
const MAX_GLYPHS = 2048; // texture layers; bigger sets are thinned by pickGlyphs

export class DitherEngine {
  readonly gl: WebGL2RenderingContext;
  private U: Record<string, WebGLUniformLocation | null> = {};
  private imgTex: WebGLTexture;
  private glyphTex: WebGLTexture;
  width = 1;
  height = 1;
  glyphCount = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error("WebGL2 is not available in this browser.");
    this.gl = gl;

    const shader = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader error");
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link error");
    gl.useProgram(prog);
    gl.bindVertexArray(gl.createVertexArray());

    for (let i = 0, n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i < n; i++) {
      const name = gl.getActiveUniform(prog, i)!.name;
      this.U[name] = gl.getUniformLocation(prog, name);
    }

    this.imgTex = this.makeTex(0);
    this.glyphTex = gl.createTexture()!;
    gl.uniform1i(this.U.uImg, 0);
    gl.uniform1i(this.U.uGlyph, 1);
  }

  private makeTex(unit: number) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  setSource(el: CanvasImageSource, w: number, h: number) {
    const gl = this.gl;
    const cap = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), MAX_IMAGE);
    const sc = Math.min(1, cap / Math.max(w, h));
    this.width = Math.max(1, Math.round(w * sc));
    this.height = Math.max(1, Math.round(h * sc));
    // Route through a 2D canvas: resizes, and flattens alpha onto black
    const c = document.createElement("canvas");
    c.width = this.width;
    c.height = this.height;
    const x = c.getContext("2d")!;
    x.fillStyle = "#000";
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(el, 0, 0, c.width, c.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  // How many glyphs the atlas can hold
  get glyphCap() {
    return Math.min(MAX_GLYPHS, this.gl.getParameter(this.gl.MAX_ARRAY_TEXTURE_LAYERS) as number);
  }

  // `list` comes from pickGlyphs: unique and at most glyphCap long
  setGlyphs(list: string[], sortInk: boolean, fitEach: boolean) {
    const gl = this.gl;
    if (!list.length) list = [" "];

    // Fit glyphs to the square. fitEach scales every glyph until its ink box
    // touches the square's edges; otherwise one scale for the whole set fits the
    // union of their ink boxes, keeping relative sizes.
    const S = GLYPH_PX, M = 100;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.textAlign = "center";
    x.textBaseline = "alphabetic";
    x.font = `${M}px ${GLYPH_FONT}`;
    const box = (ch: string) => {
      const m = x.measureText(ch);
      return { l: m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight, a: m.actualBoundingBoxAscent, d: m.actualBoundingBoxDescent };
    };
    const inked = list.filter(ch => ch.trim());
    const union = inked.map(box).reduce(
      (u, b) => ({ l: Math.max(u.l, b.l), r: Math.max(u.r, b.r), a: Math.max(u.a, b.a), d: Math.max(u.d, b.d) }),
      { l: 0, r: 0, a: 0, d: 0 });

    // Rasterize each glyph, then (optionally) order light -> dense by measured
    // ink, after 23d/ascii-scramble.js
    const glyphs = list.map(ch => {
      const b = fitEach && ch.trim() ? box(ch) : union;
      const w = b.l + b.r, h = b.a + b.d;
      const k = w > 0 && h > 0 ? S / Math.max(w, h) : (0.8 * S) / M;
      x.fillStyle = "#000";
      x.fillRect(0, 0, S, S);
      x.fillStyle = "#fff";
      x.font = `${M * k}px ${GLYPH_FONT}`;
      x.fillText(ch, S / 2 - ((b.r - b.l) / 2) * k, S / 2 - ((b.d - b.a) / 2) * k);
      x.font = `${M}px ${GLYPH_FONT}`;
      const rgba = x.getImageData(0, 0, S, S).data;
      const data = new Uint8Array(S * S);
      let ink = 0;
      for (let i = 0; i < data.length; i++) ink += data[i] = rgba[i * 4];
      return { data, ink };
    });
    if (sortInk) glyphs.sort((a, b) => a.ink - b.ink);

    // A texture array keeps each glyph in its own mipmapped layer, so small
    // squares sample a pre-filtered glyph without bleeding into neighbours.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.glyphTex);
    // One channel: glyphs are white on black, and the shader only reads .r
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8, S, S, glyphs.length, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    glyphs.forEach((g, i) =>
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, S, S, 1, gl.RED, gl.UNSIGNED_BYTE, g.data));
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    this.glyphCount = glyphs.length;
  }

  render(p: Params, focus: Focus, timeMs: number, opts: RenderOpts) {
    const gl = this.gl;
    const U = this.U;
    const n = (k: string) => Number(p[k]);
    const on = (k: string) => (p[k] ? 1 : 0);
    const f1 = (name: string, v: number) => gl.uniform1f(U[name], v);

    const sc = n("scale");
    const diag = Math.hypot(this.width, this.height);
    const maxCell = Math.max(1, 2 ** n("maxCell") * sc);
    const minCell = Math.min(maxCell, Math.max(1, n("minCell") * sc));
    // Organic: 0 = follow the shape strictly, 1 = full noise settings
    const org = n("organic") * on("organicOn");

    gl.viewport(0, 0, this.width, this.height);
    gl.uniform2f(U.uRes, this.width, this.height);
    gl.uniform2f(U.uFocus, focus.x, focus.y);
    f1("uTime", p.animate ? timeMs / 1000 : 0);
    f1("uDrift", n("drift"));
    f1("uShowField", opts.guide ? on("showField") : 0);
    f1("uGuide", opts.guide ? 1 : 0);
    f1("uGuidePx", opts.guidePx);

    gl.uniform1i(U.uShape, n("shape"));
    f1("uRadiusPx", Math.max(1, n("radius") * sc * diag));
    f1("uAspect", 2 ** n("aspect"));
    f1("uRot", (n("rotation") * Math.PI) / 180);
    f1("uWarp", n("warp") * org);
    f1("uWarpFreq", 1 / (diag * 0.15 * n("warpScale") * sc));
    gl.uniform2f(U.uSeed, (n("seed") * 12.9898) % 97, (n("seed") * 78.233) % 89);
    f1("uFalloff", n("falloff"));
    f1("uReach", n("reach"));
    f1("uIslands", n("islands") * org);
    f1("uIslandAmt", n("islandAmt"));
    f1("uIslandFreq", 1 / (n("islandSize") * sc));
    f1("uHoles", n("holes") * org);

    f1("uMaxCell", maxCell);
    f1("uMinCell", minCell);
    f1("uScatter", n("scatter"));
    // Spread is in size bands: the radius split into the N levels (as in the shader)
    const levels = Math.min(16, Math.floor(Math.log2(maxCell / minCell) + 1e-3) + 1);
    f1("uSpread", (n("spreadBands") * Math.max(1, n("radius") * sc * diag)) / levels);

    f1("uPix", n("pix") * on("pixOn"));
    f1("uBlur", n("blur") * on("blurOn"));
    f1("uBlurMax", n("blurMax") * sc);
    f1("uNoise", n("noise") * on("noiseOn"));
    f1("uDither", n("dither") * on("ditherOn"));
    f1("uDLevels", n("dLevels"));
    f1("uMono", n("mono"));
    f1("uSolid", n("solid") * on("solidOn"));
    const hex = /^#[0-9a-f]{6}$/i.test(String(p.solidColor)) ? String(p.solidColor) : "#000000";
    gl.uniform3f(U.uSolidCol, ...[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]);

    f1("uAscii", n("ascii") * on("asciiOn"));
    f1("uGCount", this.glyphCount);
    f1("uGlyphPx", GLYPH_PX);
    f1("uInvert", on("invert"));
    f1("uPlain", n("plain"));
    f1("uContrast", n("contrast"));
    f1("uSat", n("sat"));
    f1("uScramble", n("scramble"));
    f1("uScrSpeed", n("scrSpeed"));
    f1("uGlyphMin", n("glyphMin"));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  toBlob(): Promise<Blob | null> {
    return new Promise(res => this.canvas.toBlob(res, "image/png"));
  }
}
