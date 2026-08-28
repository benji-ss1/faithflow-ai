// Types for the native NDI sender addon (UNVERIFIED — needs compile).
export interface NdiSenderNative {
  /** width x height BGRA (premultiplied by default — the addon un-premultiplies
   *  before sending straight alpha to NDI). */
  sendFrame(bgra: Buffer, width: number, height: number, premultiplied?: boolean): void;
  /** Current number of connected NDI receivers (0 = still broadcasting, §19). */
  getConnections(): number;
  /** Flush + tear down the sender. */
  destroy(): void;
}
export interface NdiSenderCtor {
  new (sourceName: string, frameRateN?: number, frameRateD?: number): NdiSenderNative;
}
declare const mod: { NdiSender?: NdiSenderCtor; __loadError?: string };
export default mod;
