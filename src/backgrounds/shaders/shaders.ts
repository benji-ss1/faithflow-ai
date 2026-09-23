// GLSL fragment shaders for the 5 built-in animated backgrounds (Phase 4).
// Deliberately SIMPLE (no ray marching, ≤ a couple of sin octaves) so they hold
// 60fps at 1080p on integrated GPUs. Uniforms are shared across all presets:
//   u_resolution vec2, u_time float, u_speed float, u_intensity float,
//   u_primaryColor vec3, u_secondaryColor vec3.

export const VERTEX_SHADER = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// highp where available (all desktop GPUs): mediump (fp16) loses precision in
// sin/fract/hash after a few minutes of u_time → stepping/jitter/frozen embers
// in long services (2026-09-23 glitch audit).
const HEADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_speed;
uniform float u_intensity;
uniform vec3 u_primaryColor;
uniform vec3 u_secondaryColor;
`;

// Gentle Waves — visibly flowing undulating waves, navy → teal.
const gentleWaves = HEADER + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time * u_speed;
  // A clearly moving wave surface (two travelling sine components).
  float wave = sin(uv.x * 6.2831 + t) * 0.12
             + sin(uv.x * 12.0 - t * 1.3) * 0.06;
  wave *= u_intensity;
  float g = smoothstep(0.0, 1.0, uv.y + wave - 0.15 * sin(t * 0.5));
  vec3 c = mix(u_secondaryColor, u_primaryColor, g);
  // Bright shimmer band riding the crest so movement is obvious even from afar.
  float crest = 0.5 + 0.22 * sin(t * 0.4);
  float band = smoothstep(0.05, 0.0, abs(uv.y + wave - crest));
  c += (u_primaryColor + u_secondaryColor) * 0.18 * band * u_intensity;
  gl_FragColor = vec4(c, 1.0);
}
`;

// Deep Breath — a soft radial light that pulses (breathes) and slowly drifts.
const deepBreath = HEADER + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 c = uv - 0.5; c.x *= u_resolution.x / u_resolution.y;
  // Slowly drifting centre so it's never perfectly static.
  c -= vec2(0.07 * sin(u_time * u_speed * 0.3), 0.05 * cos(u_time * u_speed * 0.23));
  float d = length(c);
  float breath = 0.5 + 0.5 * sin(u_time * u_speed);
  float glow = smoothstep(0.75, 0.0, d) * (0.08 + 0.14 * breath) * u_intensity;
  gl_FragColor = vec4(u_secondaryColor + u_primaryColor * glow, 1.0);
}
`;

// Stained Light — flowing overlapping prismatic washes (clearly moving).
const stainedLight = HEADER + `
float wave(vec2 p){ return sin(p.x) * sin(p.y); }
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time * u_speed * 0.5;
  float a = 0.5 + 0.5 * wave(vec2(uv.x * 3.0 + t, uv.y * 2.0 - t * 0.6));
  float b = 0.5 + 0.5 * wave(vec2(uv.y * 3.6 - t * 0.8, uv.x * 2.3 + t * 0.5));
  vec3 base = vec3(0.05, 0.035, 0.085);
  vec3 color = base + u_primaryColor * a * 0.55 * u_intensity + u_secondaryColor * b * 0.55 * u_intensity;
  gl_FragColor = vec4(color, 1.0);
}
`;

// Holy Fire — warm ember particles rising. More of them so it reads as full and
// alive on a big projector (not just a dense-looking tiny thumbnail).
const holyFire = HEADER + `
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  float t = u_time * u_speed;
  vec3 color = vec3(0.055, 0.031, 0.024);
  for (int i = 0; i < 46; i++) {
    float fi = float(i);
    float x = hash(vec2(fi, 1.0));
    float spd = 0.04 + 0.10 * hash(vec2(fi, 2.0));
    float y = fract(hash(vec2(fi, 3.0)) + t * spd);
    float wob = 0.03 * sin(t * 1.4 + fi);
    vec2 pp = vec2(x + wob, 1.0 - y);
    float sz = 0.006 + 0.013 * hash(vec2(fi, 4.0));
    float dd = length((uv - pp) * vec2(aspect, 1.0));
    float glow = smoothstep(sz, 0.0, dd);
    float fade = smoothstep(0.0, 0.15, y) * smoothstep(1.0, 0.55, y);
    color += mix(u_primaryColor, u_secondaryColor, hash(vec2(fi, 5.0))) * glow * fade * 0.6 * u_intensity;
  }
  gl_FragColor = vec4(color, 1.0);
}
`;

// Clean Slate — static near-black vertical gradient (no animation).
const cleanSlate = HEADER + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  gl_FragColor = vec4(mix(u_secondaryColor, u_primaryColor, uv.y), 1.0);
}
`;


// ── 2026-09-23 motion library (code-rendered, owned outright — no licensing) ──
// Infinite procedural loops: time is a continuous wall clock (ShaderRenderer),
// so there is no loop seam to hitch. Particles wrap only where they're faded out.

const NOISE = `
// sin-free hash (Dave Hoskins hash12): stays well-distributed at the large
// time values the wall clock produces (a sin-hash clumps/freezes past ~1e5).
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
`;

// Golden Bokeh — the reference look: deep night, a soft stage spotlight from the
// top-left, and a drifting river of out-of-focus gold/white bokeh.
const goldenBokeh = HEADER + NOISE + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  float t = u_time * u_speed;
  vec3 col = mix(u_secondaryColor * 0.35, u_secondaryColor, uv.y * 0.6 + 0.2);
  // Spotlight cone from the top-left, gently breathing.
  vec2 sp = vec2(0.14, 1.05);
  float beam = smoothstep(0.55, 0.0, length((uv - sp) * vec2(aspect * 1.6, 0.9)));
  col += vec3(0.55, 0.45, 0.45) * beam * (0.42 + 0.06 * sin(t * 0.4));
  // Bokeh river along a soft diagonal band.
  for (int i = 0; i < 40; i++) {
    float fi = float(i);
    float spd = 0.008 + 0.02 * hash(vec2(fi, 2.0));
    float x = fract(hash(vec2(fi, 1.0)) + t * spd);
    float band = 0.22 + 0.28 * x + 0.18 * (hash(vec2(fi, 3.0)) - 0.5);
    float y = band + 0.025 * sin(t * 0.3 + fi);
    float big = hash(vec2(fi, 4.0));
    float r = 0.004 + 0.022 * big * big;
    float d = length((uv - vec2(x, y)) * vec2(aspect, 1.0));
    float disc = smoothstep(r, r * (0.55 - 0.3 * big), d);
    float edge = smoothstep(0.0, 0.08, x) * smoothstep(1.0, 0.92, x);
    float tw = 0.75 + 0.25 * sin(t * (0.6 + big) + fi * 3.1);
    vec3 tint = mix(u_primaryColor, vec3(1.0, 0.95, 0.85), hash(vec2(fi, 5.0)) * 0.6);
    col += tint * disc * edge * tw * (0.35 + 0.5 * (1.0 - big)) * u_intensity;
  }
  // Fine dust haze (single noise octave — at 5% strength the 4-octave fbm was
  // indistinguishable and cost 4x per pixel; 2026-09-23 perf review).
  col += u_primaryColor * 0.05 * noise(uv * 6.0 + vec2(t * 0.05, 0.0)) * u_intensity;
  gl_FragColor = vec4(col, 1.0);
}
`;

// Waterfall — falling water streaks with a mist bloom at the base.
const waterfall = HEADER + NOISE + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time * u_speed;
  vec3 col = mix(u_secondaryColor * 0.5, u_secondaryColor, uv.y);
  // Water sheet in the middle 60% of the frame.
  float sheet = smoothstep(0.15, 0.3, uv.x) * smoothstep(0.85, 0.7, uv.x);
  float streak = fbm(vec2(uv.x * 38.0, uv.y * 2.5 + t * 1.6));
  streak = pow(streak, 2.2);
  col += u_primaryColor * sheet * streak * 0.8 * u_intensity;
  // Mist rising at the bottom.
  float mist = fbm(vec2(uv.x * 3.0 + t * 0.08, uv.y * 4.0 - t * 0.35));
  col += vec3(0.85, 0.92, 1.0) * mist * smoothstep(0.45, 0.0, uv.y) * 0.4 * u_intensity;
  gl_FragColor = vec4(col, 1.0);
}
`;

// Forest Light — nature: green canopy wash, sweeping sun rays, drifting pollen.
const forestLight = HEADER + NOISE + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  float t = u_time * u_speed;
  float leaves = fbm(uv * vec2(4.0, 3.0) + vec2(t * 0.03, t * 0.02));
  vec3 col = mix(u_secondaryColor * 0.4, u_secondaryColor, leaves);
  // God rays fanning from the top-right.
  vec2 o = vec2(0.85, 1.1);
  vec2 dv = uv - o;
  float ang = atan(dv.x, -dv.y);
  float rays = 0.5 + 0.5 * sin(ang * 22.0 + sin(t * 0.25) * 1.5);
  rays *= 0.5 + 0.5 * sin(ang * 9.0 - t * 0.12);
  float fall = smoothstep(1.4, 0.0, length(dv));
  col += u_primaryColor * rays * fall * 0.45 * u_intensity;
  for (int i = 0; i < 30; i++) {
    float fi = float(i);
    vec2 p = vec2(fract(hash(vec2(fi, 1.0)) + t * 0.012 * (0.5 + hash(vec2(fi, 2.0)))),
                  fract(hash(vec2(fi, 3.0)) - t * 0.01));
    p.x += 0.02 * sin(t * 0.7 + fi);
    float d = length((uv - p) * vec2(aspect, 1.0));
    float fade = smoothstep(0.0, 0.1, p.y) * smoothstep(1.0, 0.9, p.y);
    col += u_primaryColor * smoothstep(0.005, 0.0, d) * fade * 0.8 * u_intensity;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

// Heaven Clouds — soft, angelic clouds that visibly (but gently) drift and
// billow in two parallax layers, with a warm light from above.
const heavenClouds = HEADER + NOISE + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time * u_speed;
  vec3 sky = mix(u_secondaryColor, u_primaryColor * 0.6, uv.y);
  // Domain warp makes the clouds billow/morph slowly, not just slide.
  // Warp field uses single noise octaves (was 2x fbm = 8 noise/pixel): the
  // warp is low-frequency, so the extra octaves were invisible (perf review).
  vec2 w = vec2(noise(uv * 1.5 + vec2(t * 0.03, 0.0)), noise(uv * 1.5 + vec2(0.0, t * 0.025) + 5.2));
  float back = fbm(uv * vec2(1.8, 2.4) + vec2(t * 0.035, 0.0) + w * 0.6);
  float front = fbm(uv * vec2(3.2, 4.0) + vec2(t * 0.07, t * 0.012) + w * 0.9);
  float c = smoothstep(0.36, 0.85, back * 0.7 + front * 0.55);
  vec3 cloud = mix(vec3(0.82, 0.85, 0.94), vec3(1.0, 0.93, 0.8), uv.y);
  // Cloud brightness 0.56 → 0.48 so white lyrics keep contrast over the
  // brightest clouds (design review 2026-09-23).
  vec3 col = mix(sky, cloud * 0.48, c * 0.82 * u_intensity);
  // Heavenly glow from the top, breathing very slowly.
  float glow = smoothstep(0.45, 1.25, uv.y + 0.08 * sin(t * 0.15));
  col += u_primaryColor * 0.22 * glow;
  gl_FragColor = vec4(col, 1.0);
}
`;

// Glory Dust — slow parallax starfield with twinkle, deep purple.
const gloryDust = HEADER + NOISE + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  float t = u_time * u_speed;
  vec3 col = mix(u_secondaryColor * 0.3, u_secondaryColor, 1.0 - length(uv - 0.5));
  col += u_primaryColor * 0.12 * fbm(uv * 3.0 + vec2(t * 0.02, -t * 0.015));
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    vec2 g = uv * vec2(aspect, 1.0) * (18.0 + fl * 14.0) + vec2(t * (0.08 + 0.06 * fl), t * 0.02);
    vec2 id = floor(g), f = fract(g) - 0.5;
    float h = hash(id + fl * 7.0);
    vec2 off = vec2(hash(id + 3.1), hash(id + 5.7)) - 0.5;
    float d = length(f - off * 0.6);
    float star = smoothstep(0.08 - fl * 0.015, 0.0, d) * step(0.8, h);
    float tw = 0.55 + 0.45 * sin(t * (1.0 + h * 2.0) + h * 40.0);
    col += mix(vec3(1.0), u_primaryColor, h) * star * tw * u_intensity;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

// Aurora Glow — soft northern-lights curtains over a starry night: smooth
// vertical rays that fade upward, gentle sway, no hard bands.
const auroraGlow = HEADER + NOISE + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  float t = u_time * u_speed;
  vec3 col = mix(u_secondaryColor * 0.35, u_secondaryColor, uv.y);
  // Faint stars.
  vec2 g = uv * vec2(aspect, 1.0) * 70.0;
  vec2 id = floor(g); float h = hash(id);
  float star = step(0.985, h) * smoothstep(0.35, 0.0, length(fract(g) - 0.5)) * (0.6 + 0.4 * sin(t * 1.5 + h * 50.0));
  col += vec3(0.8) * star * 0.5;
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float base = 0.55 + 0.12 * fi + 0.07 * sin(uv.x * 2.2 + t * 0.12 + fi * 1.7)
               + 0.06 * (fbm(vec2(uv.x * 1.6 + t * 0.03, fi * 4.0)) - 0.5);
    float d = uv.y - base;
    // Sharp-ish bottom edge, long soft fade upward (like real aurora).
    float curtain = smoothstep(-0.03, 0.02, d) * exp(-max(d, 0.0) * 5.0);
    float rays = 0.55 + 0.45 * fbm(vec2(uv.x * 22.0 + t * 0.08, t * 0.05 + fi * 7.0));
    vec3 c = mix(u_primaryColor, vec3(0.45, 0.35, 0.95), smoothstep(0.0, 0.25, d) * 0.7 + fi * 0.3);
    col += c * curtain * rays * 0.55 * u_intensity;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

// Still Waters — nature: a calm lake at dawn; sky reflected in gently rippling
// water, a soft sun glow on the horizon and a shimmering light path.
const stillWaters = HEADER + NOISE + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  float t = u_time * u_speed;
  float horizon = 0.46;
  vec2 sun = vec2(0.5, horizon + 0.07);
  vec3 skyTop = u_secondaryColor * 0.7;
  // Horizon band toned down x0.8 so white lyrics stay readable over it
  // (was ~#A7886D ≈ 3.2:1 vs white; design review 2026-09-23).
  vec3 skyLow = mix(u_secondaryColor, u_primaryColor, 0.65) * 0.8;
  vec3 col;
  if (uv.y > horizon) {
    float k = (uv.y - horizon) / (1.0 - horizon);
    col = mix(skyLow, skyTop, pow(k, 0.7));
    float sg = smoothstep(0.35, 0.0, length((uv - sun) * vec2(aspect, 1.0)));
    col += u_primaryColor * sg * 0.26;
    // Distant hills silhouette.
    float hill = horizon + 0.04 + 0.03 * fbm(vec2(uv.x * 3.0, 1.0));
    col = mix(col, u_secondaryColor * 0.35, smoothstep(hill + 0.004, hill, uv.y));
  } else {
    float depth = (horizon - uv.y) / horizon;
    // Ripples: horizontal wave distortion of the reflected sky.
    float rip = fbm(vec2(uv.x * 6.0, uv.y * 40.0 / (0.3 + depth) - t * 0.6)) - 0.5;
    vec2 ruv = vec2(uv.x + rip * 0.02 * depth, horizon + (horizon - uv.y) + rip * 0.03);
    float k = clamp((ruv.y - horizon) / (1.0 - horizon), 0.0, 1.0);
    col = mix(skyLow, skyTop, pow(k, 0.7)) * 0.8;
    // Shimmering sun path.
    float path = smoothstep(0.12 + 0.2 * depth, 0.0, abs(uv.x - 0.5) * aspect);
    float glint = smoothstep(0.62, 0.9, fbm(vec2(uv.x * 30.0, uv.y * 90.0 - t * 1.2)));
    col += u_primaryColor * path * (0.1 + glint * 0.38) * u_intensity;
    col *= 0.75 + 0.25 * (1.0 - depth);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export const FRAGMENT_SHADERS: Record<string, string> = {
  gentleWaves,
  deepBreath,
  stainedLight,
  holyFire,
  cleanSlate,
  goldenBokeh,
  waterfall,
  forestLight,
  heavenClouds,
  gloryDust,
  auroraGlow,
  stillWaters,
};

/** Presets that don't animate — render one frame, no rAF loop. */
export const STATIC_PRESETS = new Set(["cleanSlate"]);
