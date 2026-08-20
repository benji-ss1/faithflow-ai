// GLSL fragment shaders for the 5 built-in animated backgrounds (Phase 4).
// Deliberately SIMPLE (no ray marching, ≤ a couple of sin octaves) so they hold
// 60fps at 1080p on integrated GPUs. Uniforms are shared across all presets:
//   u_resolution vec2, u_time float, u_speed float, u_intensity float,
//   u_primaryColor vec3, u_secondaryColor vec3.

export const VERTEX_SHADER = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const HEADER = `
precision mediump float;
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

export const FRAGMENT_SHADERS: Record<string, string> = {
  gentleWaves,
  deepBreath,
  stainedLight,
  holyFire,
  cleanSlate,
};

/** Presets that don't animate — render one frame, no rAF loop. */
export const STATIC_PRESETS = new Set(["cleanSlate"]);
