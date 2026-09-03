// Types for the native NDI audio-receiver addon (UNVERIFIED — needs compile).
export interface NdiSourceInfo {
  name: string;
  urlAddress: string;
}
export interface NdiReceiverNative {
  /** Snapshot of NDI sources currently discovered on the LAN (non-blocking). */
  listSources(): NdiSourceInfo[];
  /** Connect to a source by exact NDI name and receive AUDIO only. `onAudio` is
   *  called on a background thread (marshalled to JS) with interleaved 16-bit PCM
   *  plus the source's sample rate and channel count. Returns false if the source
   *  isn't found. Throws if the receiver can't be created. */
  connect(sourceName: string, onAudio: (pcm: Buffer, sampleRate: number, channels: number) => void): boolean;
  /** Stop receiving + tear down the receiver (safe to call repeatedly). */
  disconnect(): void;
  isConnected(): boolean;
}
export interface NdiReceiverCtor {
  new (): NdiReceiverNative;
}
declare const mod: { NdiReceiver?: NdiReceiverCtor; __loadError?: string };
export default mod;
