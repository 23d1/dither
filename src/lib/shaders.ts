export const VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uImg;
uniform mediump sampler2DArray uGlyph; // one layer per glyph, mipmapped
uniform float uGlyphPx;                // glyph layer size in px
uniform vec2  uRes;        // image size in px
uniform vec2  uFocus;      // 0-1, top-left origin
uniform float uTime;
uniform float uDrift;      // 0..1: how fast the influence itself moves (needs uTime)
uniform float uShowField;
uniform float uGuide;      // draw the shape outline (never in exports)
uniform float uGuidePx;    // outline width in image px

// Area of influence
uniform int   uShape;
uniform float uRadiusPx;   // shape radius in px (already scaled)
uniform float uAspect;     // >1 wider, <1 taller
uniform float uRot;        // radians
uniform float uWarp;       // domain-warp strength (irregular outline)
uniform float uWarpFreq;   // 1/px
uniform vec2  uSeed;       // offset into all noise fields
uniform float uFalloff;    // exponent on the gradient
uniform float uReach;      // how far past the shape islands can appear, in shape radii
uniform float uIslands;    // 0 none .. 1 continuous halo
uniform float uIslandAmt;  // peak strength of an island
uniform float uIslandFreq; // 1/px
uniform float uHoles;      // clean patches punched into the area

// Squares: halve from max to min size
uniform float uMaxCell, uMinCell, uScatter;
uniform float uSpread;     // px: squares sample the field this far off-center, scattering every edge

// Effects
uniform float uPix, uBlur, uBlurMax, uNoise, uDither, uDLevels, uMono;

// ASCII
uniform float uAscii, uGCount, uInvert, uPlain, uContrast, uSat, uScramble, uScrSpeed, uGlyphMin;

out vec4 outColor;

// Integer hash: no float precision loss on big images / long runs
float ihash(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z;
  return float(v.x) / 4294967295.0;
}
uvec2 ucell(vec2 id) { return uvec2(ivec2(id) + 65536); }

float lhash(vec2 i) { return ihash(uvec3(ucell(i), 1013u)); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(lhash(i), lhash(i + vec2(1, 0)), f.x),
             mix(lhash(i + vec2(0, 1)), lhash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}

// Normalized shape distance: 0 at center, 1 on the outline
float shapeD(vec2 q) {
  if (uShape == 1) return max(abs(q.x), abs(q.y));                                   // square
  if (uShape == 2) { vec2 a = q * q; return sqrt(sqrt(dot(a * a, vec2(1.0)))); }       // rounded square
  if (uShape == 3) return abs(q.x) + abs(q.y);                                         // diamond
  if (uShape == 4) { q = abs(q); return max(q.x * 0.8660254 + q.y * 0.5, q.y); }       // hexagon
  if (uShape == 5) return length(q) / (0.62 + 0.38 * cos(5.0 * atan(q.y, q.x)));      // star
  if (uShape == 6) { q = abs(q); return min(max(q.x * 3.0, q.y), max(q.x, q.y * 3.0)); } // cross
  if (uShape == 7) return abs(length(q) - 0.65) / 0.35;                               // ring
  if (uShape == 8) return abs(q.y);                                                    // band
  return length(q);                                                                    // circle
}

// Shape distance at p, after rotation, aspect and the irregular warp
float shapeR(vec2 p) {
  vec2 d = p - uFocus * uRes;
  float c = cos(uRot), s = sin(uRot);
  vec2 q = vec2(c * d.x + s * d.y, -s * d.x + c * d.y) / uRadiusPx;
  q.x /= uAspect;
  if (uWarp > 0.0) {
    vec2 w = p * uWarpFreq + uSeed + uTime * uDrift * vec2(0.08, 0.05);
    q += (vec2(fbm(w), fbm(w + vec2(5.2, 1.3))) - 0.5) * 2.0 * uWarp;
  }
  return shapeD(q);
}

// Depth inside a noise blob: 0 at its rim (where n crosses 1 - amt), rising
// smoothly to 1 toward its peak, so each blob tapers like the main shape. The
// ramp spans half the headroom above the rim, so even small amounts (few blobs)
// reach full depth in their middle rather than topping out at half strength.
float blob(float n, float amt) {
  return smoothstep(0.0, 1.0, clamp((n - (1.0 - amt)) / (min(amt, 0.25) * 0.5), 0.0, 1.0));
}

// Strength of the effect at p: 1 = full, 0 = untouched image
float fieldAt(vec2 p, float r) {
  // Falloff shapes the gradient; the smoothstep always eases it in from 0 at
  // the outline, so even a low Falloff (broad plateau) has no cliff at the edge
  float e = clamp(1.0 - r, 0.0, 1.0);
  float f = pow(e, uFalloff) * smoothstep(0.0, 0.15, e);

  // Islands: random patches past the outline that fade out over reach.
  // Each one peaks at its center and tapers to its rim.
  vec2 ip = p * uIslandFreq + uSeed * 1.7 + uTime * uDrift * vec2(0.25, -0.15);
  if (uReach > 0.0 && uIslands > 0.0) {
    float h = pow(clamp(1.0 - max(r - 1.0, 0.0) / uReach, 0.0, 1.0), uFalloff);
    float m = blob(vnoise(ip), uIslands);
    f = max(f, h * m * uIslandAmt * mix(0.25, 1.0, vnoise(ip * 0.7 + 31.7)));
  }
  // Holes: clean at their center, grading back into the effect at their rim
  if (uHoles > 0.0) f *= 1.0 - blob(vnoise(ip * 1.3 + 71.3), uHoles);
  return f;
}
float field(vec2 p) { return fieldAt(p, shapeR(p)); }

// Spread: where square ci of level i samples the field, relative to its
// center. A triangular random offset (soft tail), so near any edge some squares
// land inside and some outside and influence thins out over a band instead of
// stopping at a line. Drift makes each offset orbit at its own speed, so squares
// near an edge wander in and out of the influence over time.
vec2 jitter(vec2 ci, int i, float si) {
  uvec2 uc = ucell(ci);
  uint hk = uint(i) * 4u + 101u;
  vec2 j = vec2(ihash(uvec3(uc, hk)), ihash(uvec3(uc, hk + 1u))) +
           vec2(ihash(uvec3(uc, hk + 2u)), ihash(uvec3(uc, hk + 3u))) - 1.0;
  float a = uTime * uDrift * (j.x + j.y) * 2.0;
  // At least a third of the square's own size, so big squares scatter across
  // their boundary too instead of ending along a clean curve
  return mat2(cos(a), sin(a), -sin(a), cos(a)) * j * max(uSpread, si * 0.35);
}

// The square grid: anchored so the largest square is centered on the focus;
// N levels halve from max to min size
vec2 gridOrigin() { return uFocus * uRes - 0.5 * uMaxCell; }
float levels() { return min(16.0, floor(log2(uMaxCell / uMinCell) + 1e-3) + 1.0); }

float b2(vec2 a) { a = mod(floor(a), 2.0); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer8(vec2 a) { return b2(0.25 * a) * 0.0625 + b2(0.5 * a) * 0.25 + b2(a); }

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 saturate3(vec3 c, float s) { return clamp(mix(vec3(luma(c)), c, s), 0.0, 1.0); }

vec3 src(vec2 p, float lod) {
  return textureLod(uImg, clamp(p / uRes, vec2(0.0), vec2(1.0)), lod).rgb;
}

// Golden-angle disk average; also used to average a whole square
vec3 disk(vec2 p, float rad) {
  if (rad < 0.75) return src(p, 0.0);
  float lod = log2(max(rad * 0.35, 1.0));
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float a = fi * 2.39996323;
    float r = sqrt((fi + 0.5) / 16.0) * rad;
    acc += src(p + vec2(cos(a), sin(a)) * r, lod);
  }
  return acc / 16.0;
}

vec3 shade(vec2 px, float fp) {
  vec3 orig = src(px, 0.0);
  if (uShowField > 0.5) return orig * 0.25 + vec3(0.78, 1.0, 0.24) * fp * 0.85;

  // Squares halve from max to min size. A square is used where the field at its
  // (spread-jittered) center clears 1 - (i+1)/N, so big squares sit where the field is strong and
  // they taper until the original shows through. The grid is anchored so the
  // largest square is centered on the focus, and every level nests in the one above.
  vec2 org = gridOrigin();
  float N = levels();
  float s = 0.0, t = 0.0;
  vec2 id = vec2(0.0), loc = vec2(0.0);
  for (int i = 0; i < 16; i++) {
    if (float(i) >= N) break;
    float si = uMaxCell * exp2(-float(i));
    vec2 g = (px - org) / si;
    vec2 ci = floor(g);
    vec2 c = org + (ci + 0.5) * si;
    if (uSpread > 0.0) c += jitter(ci, i, si);
    float fc = field(c);
    // Scatter: jitter each square's threshold (in field units, so it doesn't
    // depend on how many levels there are). Mixes neighbouring sizes, and lets
    // the faintest squares randomly drop out so the frontier thins.
    float fv = fc + (ihash(uvec3(ucell(ci), uint(i) + 7u)) - 0.5) * uScatter * 0.6;
    if (fc > 0.0 && fv > 1.0 - float(i + 1) / N) {
      s = si; id = ci; loc = g - ci; t = fc;
      break;
    }
  }

  bool cell = s > 0.0;
  if (!cell && fp <= 0.0) return orig;

  // With squares on, a whole square shares its strength; otherwise follow the smooth field
  bool squares = cell && uPix > 0.0;
  float k = squares ? max(fp, t) : fp;
  vec2 center = org + (id + 0.5) * s;

  // Blur + squares
  float br = uBlur * uBlurMax * k;
  vec3 pixCol = disk(px, br);
  vec3 cellCol = cell ? disk(center, max(br, s * 0.5)) : pixCol;
  vec3 col = squares ? mix(pixCol, cellCol, uPix) : pixCol;

  // Noise
  uint frame = uint(uTime * 60.0);
  col += (ihash(uvec3(uvec2(gl_FragCoord.xy), frame)) - 0.5) * uNoise * k * 0.6;

  // Ordered dither (per square when squares dominate, per pixel otherwise)
  if (uDither > 0.0) {
    vec2 dc = squares && uPix >= 0.5 ? id : floor(px);
    float b = bayer8(dc);
    float L = uDLevels - 1.0;
    vec3 q = floor(clamp(col, 0.0, 1.0) * L + b) / L;
    q = mix(q, vec3(floor(clamp(luma(col), 0.0, 1.0) * L + b) / L), uMono);
    col = mix(col, q, uDither * smoothstep(0.0, 0.15, k));
  }

  // ASCII, one glyph per square. The ramp is sorted light->dense by measured ink.
  // Each square rolls "plain" (coloured glyph on black) or "mosaic" (square filled
  // with its colour, glyph in a contrasting shade). Dense squares can scramble
  // through random dense glyphs over time.
  if (uAscii > 0.0 && cell) {
    float L = luma(cellCol);
    float r = uInvert > 0.5 ? 1.0 - L : L;
    float gi = min(floor(clamp(r, 0.0, 1.0) * uGCount), uGCount - 1.0);
    uvec2 uc = ucell(id);
    uint lvl = uint(s * 16.0);
    float dense = floor(uGCount * 0.5);
    if (uScramble > 0.0 && gi >= dense && uGCount > 1.0) {
      float tick = floor(uTime * uScrSpeed + ihash(uvec3(uc, lvl)) * 8.0);
      uvec3 key = uvec3(uc, lvl + uint(tick) * 7919u);
      if (ihash(key) < uScramble)
        gi = min(dense + floor(ihash(key + 13u) * (uGCount - dense)), uGCount - 1.0);
    }
    float g = textureLod(uGlyph, vec3(loc, gi), max(0.0, log2(uGlyphPx / s))).r;

    vec3 inkBase = saturate3(cellCol, uSat);
    bool plain = ihash(uvec3(uc, lvl + 99991u)) < uPlain;
    vec3 asc;
    if (plain) {
      asc = inkBase * g;
    } else {
      vec3 ink = mix(inkBase, L > 0.5 ? vec3(0.0) : vec3(1.0), uContrast);
      asc = mix(saturate3(squares ? col : cellCol, uSat), ink, g);
    }
    // Glyph density follows strength, and each square gets its own size
    // threshold, so glyphs thin out toward the edge instead of stopping at a line
    float ag = step(ihash(uvec3(uc, lvl + 4243u)), smoothstep(0.05, 0.5, t))
             * step(uGlyphMin * exp2(ihash(uvec3(uc, lvl + 4271u)) - 0.5), s);
    col = mix(col, asc, uAscii * ag * smoothstep(0.0, 0.3, t));
  }

  return clamp(col, 0.0, 1.0);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float r = shapeR(px);
  float fw = max(fwidth(r), 1e-5);   // outside any branch so derivatives stay valid
  // The pixel's own strength (blur, noise, dither, field view) is scattered like
  // the smallest squares, with the same offsets, so it agrees with them
  float fp = fieldAt(px, r);
  if (uSpread > 0.0) {
    float N = levels();
    float sm = uMaxCell * exp2(-(N - 1.0));
    fp = field(px + jitter(floor((px - gridOrigin()) / sm), int(N) - 1, sm));
  }
  vec3 col = shade(px, fp);

  if (uGuide > 0.5) {
    float hw = uGuidePx * 0.5;
    float edge = 1.0 - smoothstep(hw, hw + 1.0, abs(r - 1.0) / fw);
    float reach = 0.0;
    if (uReach > 0.0 && uIslands > 0.0) {
      float dash = step(0.5, fract((px.x + px.y) / (uGuidePx * 14.0)));
      reach = (1.0 - smoothstep(hw, hw + 1.0, abs(r - 1.0 - uReach) / fw)) * dash * 0.6;
    }
    col = mix(col, vec3(0.78, 1.0, 0.24), max(edge, reach));
  }
  outColor = vec4(col, 1.0);
}
`;
