// Hardware I/O Phase B: pure DSP behind the RtAudio capture tier.
import {
  parsePanFilter, mixToMono, StreamingResampler, channelLevels,
  encodeDeviceIndex, decodeDeviceIndex, API_DECKLINK, isDeckLinkIndex, deckLinkChannels,
} from "../electron/audio/rtaudioDsp";

let passed = 0, failed = 0;
const check = (n: string, c: boolean) => { if (c) passed++; else { failed++; console.error("FAIL:", n); } };
const near = (a: number, b: number, e = 1e-3) => Math.abs(a - b) < e;

// pan parsing — must accept exactly what nativeDeviceStore.buildChannelFilter emits
check("mono", JSON.stringify(parsePanFilter("pan=mono|c0=c6")) === '[{"channel":6,"gain":1}]');
check("gain", JSON.stringify(parsePanFilter("pan=mono|c0=1.995*c6")) === '[{"channel":6,"gain":1.995}]');
check("stereo", parsePanFilter("pan=mono|c0=0.5*c0+0.5*c1")?.length === 2);
check("undefined → sum-all", parsePanFilter(undefined) === null);
check("garbage → sum-all", parsePanFilter("volume=2") === null && parsePanFilter("pan=mono|c0=rm -rf") === null);

check("bounded terms", parsePanFilter("pan=mono|c0=" + Array.from({ length: 65 }, (_, i) => `c${i}`).join("+")) === null);
check("bounded gain", parsePanFilter("pan=mono|c0=1e308*c0") === null && parsePanFilter("pan=mono|c0=99*c0") === null);
check("huge string rejected", parsePanFilter("pan=mono|c0=" + "c0+".repeat(1e5) + "c0") === null);

// mixing: 3 channels, input 3 (index 2) carries the pastor
const il = new Int16Array([0, 0, 16384, 0, 0, -16384]);
const m = mixToMono(il, 3, parsePanFilter("pan=mono|c0=c2"));
check("picks input 3", m.length === 2 && near(m[0], 0.5) && near(m[1], -0.5));
check("sum-all is sqrt(N) normalised", near(mixToMono(il, 3, null)[0], 0.5 / Math.sqrt(3)));
check("out-of-range channel ignored", mixToMono(il, 3, [{ channel: 9, gain: 1 }])[0] === 0);

// resampling 48k → 16k: 3:1, streaming chunks sum to the same length as one shot
const one = new StreamingResampler(48000, 16000).process(new Float32Array(4800).fill(0.25));
check("48k→16k length", Math.abs(one.length - 1600) <= 1);
check("dc preserved", Math.abs(one[800] - Math.round(0.25 * 32767)) <= 2);
// anti-alias: a 12 kHz tone at 48k would fold to 4 kHz — must be strongly attenuated
{
  const rs = new StreamingResampler(48000, 16000);
  const tone = (hz: number) => Float32Array.from({ length: 48000 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / 48000));
  const rms = (a: Int16Array) => Math.sqrt(a.slice(400).reduce((s, v) => s + (v / 32768) ** 2, 0) / (a.length - 400));
  const pass = rms(new StreamingResampler(48000, 16000).process(tone(1000)));
  const alias = rms(rs.process(tone(12000)));
  check("1 kHz passes (~-9 dBFS)", pass > 0.3);
  check("12 kHz alias attenuated > 40 dB", 20 * Math.log10(alias / pass) < -40);
}
const r = new StreamingResampler(44100, 16000);
let total = 0;
for (let i = 0; i < 100; i++) total += r.process(new Float32Array(441).fill(0)).length;
check("44.1k→16k streaming ≈ 16000/s", Math.abs(total - 16000) <= 2);

// levels
const lv = channelLevels(il, 3);
check("levels per channel", lv.length === 3 && lv[0].rms === 0 && near(lv[2].peak, 0.5));

// index encoding
const idx = encodeDeviceIndex(6, 3);
check("index roundtrip", decodeDeviceIndex(idx).api === 6 && decodeDeviceIndex(idx).id === 3);
check("apis never collide", encodeDeviceIndex(6, 3) !== encodeDeviceIndex(7, 3));

// Blackmagic routing
check("decklink index detected", isDeckLinkIndex(encodeDeviceIndex(API_DECKLINK, 0)));
check("coreaudio/asio/swift/ffmpeg indices are not decklink", !isDeckLinkIndex(encodeDeviceIndex(1, 3)) && !isDeckLinkIndex(encodeDeviceIndex(6, 3)) && !isDeckLinkIndex(3) && !isDeckLinkIndex(NaN));
check("decklink channels snap to 2/8/16", deckLinkChannels(16) === 16 && deckLinkChannels(32) === 16 && deckLinkChannels(8) === 8 && deckLinkChannels(6) === 2 && deckLinkChannels(undefined) === 2);

console.log(`rtaudio-dsp: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
