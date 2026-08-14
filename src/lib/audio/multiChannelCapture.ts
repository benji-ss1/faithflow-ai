/**
 * multiChannelCapture
 * -------------------------------------------------------------------------
 * Opens a multi-channel USB audio input (e.g. Allen & Heath SQ, X32,
 * Yamaha TF, Soundcraft Ui) and exposes:
 *
 *   1. Per-channel live level metering (peak / RMS / vocal-band energy)
 *      so the operator picker UI can visualize every mixer channel
 *      simultaneously and pick the one carrying the pastor's voice.
 *
 *   2. A `extractChannelStream(channels)` helper that returns a fresh
 *      MediaStream containing ONLY the selected channel (or a stereo
 *      pair), so the downstream Deepgram bridge / any consumer can
 *      treat it exactly like a plain mono/stereo microphone stream.
 *
 * How this fits in the pipeline:
 *
 *     Device (32ch)
 *        │
 *        ▼
 *     MediaStreamAudioSourceNode
 *        │
 *        ▼
 *     ChannelSplitterNode(32)
 *        ├── AnalyserNode ch0  ──► readLevels()[0]
 *        ├── AnalyserNode ch1  ──► readLevels()[1]
 *        ├── ...
 *        └── AnalyserNode chN
 *
 *     extractChannelStream([n])   →  splitter[n]  → gain → MediaStreamDest
 *     extractChannelStream([a,b]) →  splitter[a,b]→ merger(2) → MediaStreamDest
 *
 * Replaces the v0.1.77 safety net that summed ALL channels to mono. The
 * safety net is retained by callers as a fallback; this module is the
 * "proper" per-channel path.
 *
 * No React. Browser-only (Web Audio + MediaStream APIs).
 */

// --- Types -----------------------------------------------------------------

export interface ChannelLevels {
  /** Peak absolute sample value in the last analyser window. 0..1 */
  peak: number;
  /** Root-mean-square of the last analyser window. 0..1 */
  rms: number;
  /**
   * Normalized FFT energy in the vocal band (300Hz - 3400Hz).
   * Useful for picking a "voice" channel among many drum/instrument feeds.
   * 0..1 (normalized against the theoretical max byte-domain sum).
   */
  vocalBandEnergy: number;
  /**
   * Speech-vs-singing score 0..1 (Phase 2). HIGHER = more speech-like (a talking
   * preacher); LOWER = more song-like (sustained singing / a held note). Blends:
   *   - spectral flux: speech has rapid frame-to-frame spectral change from
   *     consonants + articulation; sustained singing is spectrally steady.
   *   - energy burstiness: speech is bursty (words + pauses); singing is
   *     continuous. Measured as the coefficient of variation of recent vocal
   *     energy over a ~2s window.
   * Thresholds are first-pass and meant to be tuned on real JPD service audio.
   */
  speechiness: number;
}

export interface MultiChannelCaptureOptions {
  deviceId: string;
  /** Requested channel count. Passed as `ideal`; device may return fewer. Default 32. */
  requestedChannels?: number;
  /** Analyser FFT size. Default 256 (fast, low CPU, adequate for meters). */
  fftSize?: number;
  /** Analyser smoothing. Default 0.4 (a little smoothing so meters don't strobe). */
  smoothingTimeConstant?: number;
}

export interface MultiChannelCapture {
  /** Actual channel count from the device (may be less than requested). */
  channelCount: number;
  /** Audio context sample rate — needed to size the vocal-band bins. */
  sampleRate: number;
  /** Underlying source stream — kept so callers can inspect / diagnose. */
  stream: MediaStream;
  /** Underlying audio context — exposed for advanced callers; do not close manually. */
  audioContext: AudioContext;
  /** Snapshot all channel levels. Cheap; safe to poll ~20fps. */
  readLevels(): ChannelLevels[];
  /**
   * Create a MediaStream containing only the requested channel(s).
   *   [n]       → mono stream summed from channel n
   *   [n, m]    → stereo stream with n→L, m→R
   * The returned stream is owned by this capture and is torn down on close().
   */
  extractChannelStream(channels: number[]): MediaStream;
  /**
   * Hot-swap the active channel routing without restarting the capture.
   * Disconnects previously extracted gain/merger nodes, creates new ones
   * for the requested channels, and returns the new MediaStream.
   * The AudioContext, splitter, and analysers stay connected — zero gap.
   */
  switchChannel(channels: number[]): MediaStream;
  /** Fully tear down: disconnect nodes, close context, stop tracks. */
  close(): void;
}

// --- Implementation --------------------------------------------------------

function binForHz(hz: number, sampleRate: number, fftSize: number): number {
  return Math.max(0, Math.min(fftSize / 2 - 1, Math.round(hz / (sampleRate / fftSize))));
}

export async function openMultiChannelCapture(
  opts: MultiChannelCaptureOptions
): Promise<MultiChannelCapture> {
  const {
    deviceId,
    requestedChannels = 32,
    fftSize = 256,
    smoothingTimeConstant = 0.4,
  } = opts;

  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("multiChannelCapture: navigator.mediaDevices is unavailable");
  }

  // 1. Acquire the raw multi-channel stream. Disable all DSP so channels
  //    stay independent and pristine for meter accuracy + downstream ASR.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      channelCount: { ideal: requestedChannels },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const track = stream.getAudioTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* noop */
      }
    });
    throw new Error("multiChannelCapture: stream contained no audio tracks");
  }

  const settings = track.getSettings();
  const actualChannelCount =
    typeof settings.channelCount === "number" && settings.channelCount > 0
      ? settings.channelCount
      : 1;

  // 2. Build the audio graph. Let AudioContext pick its native sample rate.
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);

  const splitter = audioContext.createChannelSplitter(actualChannelCount);
  source.connect(splitter);

  // 3. Per-channel analysers. Discrete channel interpretation so each
  //    analyser only sees its own channel — no upmix bleed.
  const analysers: AnalyserNode[] = [];
  const timeBuffers: Float32Array<ArrayBuffer>[] = [];
  const freqBuffers: Uint8Array<ArrayBuffer>[] = [];
  // Phase 2 speech-vs-singing state: last frame's spectrum (for spectral flux)
  // and a short ring of recent vocal energy (for burstiness) per channel.
  const prevFreqBuffers: Uint8Array[] = [];
  const energyRings: number[][] = [];
  const ENERGY_RING_LEN = 30; // ~2s at the 15fps meter poll

  for (let i = 0; i < actualChannelCount; i += 1) {
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = smoothingTimeConstant;
    analyser.channelCount = 1;
    analyser.channelCountMode = "explicit";
    analyser.channelInterpretation = "discrete";
    splitter.connect(analyser, i, 0);
    analysers.push(analyser);
    timeBuffers.push(new Float32Array(new ArrayBuffer(analyser.fftSize * 4), 0, analyser.fftSize));
    freqBuffers.push(new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount), 0, analyser.frequencyBinCount));
    prevFreqBuffers.push(new Uint8Array(analyser.frequencyBinCount));
    energyRings.push([]);
  }

  // 4. Pre-compute vocal-band bin range for the current sample rate.
  const sampleRate = audioContext.sampleRate;
  const vocalLoBin = binForHz(300, sampleRate, fftSize);
  const vocalHiBin = binForHz(3400, sampleRate, fftSize);
  const vocalBinCount = Math.max(1, vocalHiBin - vocalLoBin + 1);
  const vocalNorm = vocalBinCount * 255;

  // Track destinations we create so close() can tear them down.
  const extractedDestinations: MediaStreamAudioDestinationNode[] = [];
  const extractedNodes: AudioNode[] = [];

  const readLevels = (): ChannelLevels[] => {
    const out: ChannelLevels[] = new Array(actualChannelCount);
    for (let i = 0; i < actualChannelCount; i += 1) {
      const analyser = analysers[i]!;
      const timeBuf = timeBuffers[i]!;
      const freqBuf = freqBuffers[i]!;

      analyser.getFloatTimeDomainData(timeBuf);
      analyser.getByteFrequencyData(freqBuf);

      let peak = 0;
      let sumSquares = 0;
      for (let s = 0; s < timeBuf.length; s += 1) {
        const v = timeBuf[s]!;
        const abs = v < 0 ? -v : v;
        if (abs > peak) peak = abs;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / timeBuf.length);

      let vocalSum = 0;
      // Spectral flux over the vocal band (rectified positive difference from the
      // previous frame). Speech = high flux (consonants/articulation); sustained
      // singing = low flux (steady spectrum).
      const prevFreq = prevFreqBuffers[i]!;
      let flux = 0;
      for (let b = vocalLoBin; b <= vocalHiBin; b += 1) {
        const cur = freqBuf[b] ?? 0;
        vocalSum += cur;
        const d = cur - (prevFreq[b] ?? 0);
        if (d > 0) flux += d;
        prevFreq[b] = cur;
      }
      const vocalBandEnergyRaw = vocalNorm > 0 ? vocalSum / vocalNorm : 0;
      const vocalBandEnergy = vocalBandEnergyRaw > 1 ? 1 : vocalBandEnergyRaw;
      const fluxNorm = vocalNorm > 0 ? flux / vocalNorm : 0;

      // Energy burstiness — coefficient of variation of recent vocal energy.
      // Speech is bursty (words + gaps → high CV); singing is continuous (low CV).
      const ring = energyRings[i]!;
      ring.push(vocalBandEnergy);
      if (ring.length > ENERGY_RING_LEN) ring.shift();
      let mean = 0;
      for (const e of ring) mean += e;
      mean /= Math.max(1, ring.length);
      let varr = 0;
      for (const e of ring) varr += (e - mean) * (e - mean);
      varr /= Math.max(1, ring.length);
      const cv = mean > 0.005 ? Math.sqrt(varr) / mean : 0;

      // Blend → speechiness. CALIBRATED on real JPD service audio (2026-08-14:
      // 4 recordings incl. a full sung-worship → spoken-prayer → worship arc,
      // ~4600 labelled 15fps polls). Key finding: burstiness (CV of the vocal-
      // energy envelope) cleanly separates speech from singing — sung worship
      // median CV ≈ 0.038, spoken prayer ≈ 0.103 — while spectral FLUX barely
      // differs between them at this FFT resolution (≈0.017 both), so flux is
      // demoted to a light support term. With CV_REF=0.18 and an 0.85 CV weight,
      // the slow-EMA role signal lands sung worship at ~0.22-0.32 (🎶 worship
      // band) and spoken prayer at ~0.54 (🎤 preacher band), with ambiguous
      // energetic worship falling into the no-badge middle rather than mislabel.
      // (Original flux-dominant 0.6/0.4 split read prayer ≈ singing and missed
      // the speaker entirely — see scratchpad calibration.)
      // Warm-up guard: for the first few frames the previous-spectrum buffer is
      // still zero (→ spuriously maximal spectral flux) and the energy ring is
      // too short for a meaningful CV, so both read as false "speech". Return 0
      // until the ring warms — prevents a false preacher badge / switch flash on
      // capture start and right after a channel hot-swap.
      const FLUX_REF = 0.06, CV_REF = 0.18, SPEECH_WARMUP = 5;
      const speechiness = ring.length < SPEECH_WARMUP ? 0 : Math.max(0, Math.min(1,
        Math.min(1, cv / CV_REF) * 0.85 + Math.min(1, fluxNorm / FLUX_REF) * 0.15,
      ));

      out[i] = {
        peak: peak > 1 ? 1 : peak,
        rms: rms > 1 ? 1 : rms,
        vocalBandEnergy,
        speechiness,
      };
    }
    return out;
  };

  const extractChannelStream = (channels: number[]): MediaStream => {
    if (!channels || channels.length === 0) {
      throw new Error("extractChannelStream: at least one channel index required");
    }
    for (const c of channels) {
      if (c < 0 || c >= actualChannelCount) {
        throw new Error(
          `extractChannelStream: channel ${c} out of range (device has ${actualChannelCount})`
        );
      }
    }

    if (channels.length === 1) {
      const dest = audioContext.createMediaStreamDestination();
      // channelCount 1 = mono destination
      dest.channelCount = 1;
      dest.channelCountMode = "explicit";
      dest.channelInterpretation = "discrete";
      const gain = audioContext.createGain();
      gain.gain.value = 1.0;
      splitter.connect(gain, channels[0]!, 0);
      gain.connect(dest);
      extractedNodes.push(gain);
      extractedDestinations.push(dest);
      return dest.stream;
    }

    if (channels.length === 2) {
      const dest = audioContext.createMediaStreamDestination();
      dest.channelCount = 2;
      dest.channelCountMode = "explicit";
      dest.channelInterpretation = "discrete";
      const merger = audioContext.createChannelMerger(2);
      splitter.connect(merger, channels[0]!, 0);
      splitter.connect(merger, channels[1]!, 1);
      merger.connect(dest);
      extractedNodes.push(merger);
      extractedDestinations.push(dest);
      return dest.stream;
    }

    // >2 channels: sum them into a single mono destination. Useful for
    // group-buss listening (e.g. all vocal mics → one meter).
    const dest = audioContext.createMediaStreamDestination();
    dest.channelCount = 1;
    dest.channelCountMode = "explicit";
    dest.channelInterpretation = "discrete";
    const gain = audioContext.createGain();
    gain.gain.value = 1.0 / channels.length;
    for (const c of channels) {
      splitter.connect(gain, c, 0);
    }
    gain.connect(dest);
    extractedNodes.push(gain);
    extractedDestinations.push(dest);
    return dest.stream;
  };

  const switchChannel = (channels: number[]): MediaStream => {
    // Tear down all previously extracted nodes (but NOT the splitter/analysers).
    for (const node of extractedNodes) {
      try { node.disconnect(); } catch { /* noop */ }
    }
    for (const dest of extractedDestinations) {
      try { dest.disconnect(); } catch { /* noop */ }
      try { dest.stream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    }
    extractedNodes.length = 0;
    extractedDestinations.length = 0;
    // Create new extraction for the requested channels.
    return extractChannelStream(channels);
  };

  const close = (): void => {
    for (const node of extractedNodes) {
      try {
        node.disconnect();
      } catch {
        /* noop */
      }
    }
    for (const dest of extractedDestinations) {
      try {
        dest.disconnect();
      } catch {
        /* noop */
      }
      try {
        dest.stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* noop */
      }
    }
    for (const analyser of analysers) {
      try {
        analyser.disconnect();
      } catch {
        /* noop */
      }
    }
    try {
      splitter.disconnect();
    } catch {
      /* noop */
    }
    try {
      source.disconnect();
    } catch {
      /* noop */
    }
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* noop */
    }
    audioContext.close().catch(() => {
      /* noop */
    });
  };

  return {
    channelCount: actualChannelCount,
    sampleRate,
    stream,
    audioContext,
    readLevels,
    extractChannelStream,
    switchChannel,
    close,
  };
}
