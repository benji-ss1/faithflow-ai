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

// Gentle Waves — slow undulating gradient, deep navy → teal.
const gentleWaves = HEADER + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time * u_speed;
  float wave = sin(uv.x * 3.0 + t * 0.5) * 0.04 * u_intensity;
  wave += sin(uv.y * 2.0 + t * 0.3) * 0.03 * u_intensity;
  float blend = smoothstep(0.0, 1.0, uv.y + wave);
  gl_FragColor = vec4(mix(u_primaryColor, u_secondaryColor, blend), 1.0);
}
`;

// Deep Breath — a single soft radial light that pulses like breathing.
const deepBreath = HEADER + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 c = uv - 0.5; c.x *= u_resolution.x / u_resolution.y;
  float d = length(c);
  float breath = 0.5 + 0.5 * sin(u_time * u_speed * 0.9);
  float glow = smoothstep(0.65, 0.0, d) * (0.05 + 0.07 * breath) * u_intensity;
  gl_FragColor = vec4(u_secondaryColor + u_primaryColor * glow, 1.0);
}
`;

// Stained Light — very slow prismatic washes over a deep purple-black.
const stainedLight = HEADER + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time * u_speed * 0.12;
  float a = 0.16 * sin(uv.x * 2.0 + t) * sin(uv.y * 1.5 - t * 0.7);
  float b = 0.13 * sin(uv.y * 2.5 - t * 0.8 + 1.0) * sin(uv.x * 1.2 + t * 0.5);
  vec3 base = vec3(0.047, 0.031, 0.078);
  vec3 color = base + u_primaryColor * max(0.0, a) * u_intensity + u_secondaryColor * max(0.0, b) * u_intensity;
  gl_FragColor = vec4(color, 1.0);
}
`;

// Holy Fire — warm ember particles drifting up from the bottom.
const holyFire = HEADER + `
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  float t = u_time * u_speed;
  vec3 color = vec3(0.055, 0.031, 0.024);
  for (int i = 0; i < 28; i++) {
    float fi = float(i);
    float x = hash(vec2(fi, 1.0));
    float spd = 0.04 + 0.09 * hash(vec2(fi, 2.0));
    float y = fract(hash(vec2(fi, 3.0)) + t * spd);
    float wob = 0.025 * sin(t * 1.4 + fi);
    vec2 pp = vec2(x + wob, 1.0 - y);
    float sz = 0.006 + 0.012 * hash(vec2(fi, 4.0));
    float dd = length((uv - pp) * vec2(aspect, 1.0));
    float glow = smoothstep(sz, 0.0, dd);
    float fade = smoothstep(0.0, 0.15, y) * smoothstep(1.0, 0.55, y);
    color += mix(u_primaryColor, u_secondaryColor, hash(vec2(fi, 5.0))) * glow * fade * 0.55 * u_intensity;
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
