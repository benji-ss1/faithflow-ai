// rtaudioWorker.ts — entry point of the isolated audio-driver utility process.
//
// Spawned by rtaudioCapture.ts via Electron's utilityProcess.fork(). Hosts the
// native audio drivers (audify/RtAudio + Blackmagic DeckLink addon) so that any
// native crash — during use or at exit — kills only THIS process. The main
// process detects the exit, tells the operator, restarts the worker and
// reconnects capture.
//
// Protocol (structured-clone messages over process.parentPort):
//   main → worker  { id, op, args }
//   worker → main  { id, ok: true, result } | { id, ok: false, error }
//   worker → main  { event: <ipc channel>, payload }   (PCM, levels, errors)

import {
  setEngineSink,
  isRtAudioAvailable,
  listRtAudioDevices,
  listDeckLinkAudioDevices,
  startRtAudioCapture,
  stopRtAudioCapture,
  startRtAudioProbe,
  stopRtAudioProbe,
} from "./rtaudioEngine";

type ParentPort = {
  on(event: "message", fn: (e: { data: unknown }) => void): void;
  postMessage(msg: unknown): void;
};
const port = (process as unknown as { parentPort?: ParentPort }).parentPort;

if (!port) {
  // Not running as a utility process — nothing to serve.
  console.error("[rtaudio-worker] no parentPort; exiting");
  process.exit(1);
}

setEngineSink((event, payload) => port!.postMessage({ event, payload }));

const ops: Record<string, (args: unknown) => unknown> = {
  isAvailable: () => isRtAudioAvailable(),
  listDevices: () => listRtAudioDevices(),
  listDeckLink: () => listDeckLinkAudioDevices(),
  startCapture: (a) => startRtAudioCapture(a as { deviceIndex: number; channelFilter?: string }),
  stopCapture: () => stopRtAudioCapture(),
  startProbe: (a) => startRtAudioProbe(a as { deviceIndex: number }),
  stopProbe: () => stopRtAudioProbe(),
};

port.on("message", (e) => {
  const msg = e.data as { id?: number; op?: string; args?: unknown };
  if (typeof msg?.id !== "number" || typeof msg.op !== "string" || !ops[msg.op]) return;
  const id = msg.id;
  Promise.resolve()
    .then(() => ops[msg.op!](msg.args))
    .then(
      (result) => port!.postMessage({ id, ok: true, result }),
      (err: unknown) => port!.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
});

port.postMessage({ event: "__ready", payload: null });
