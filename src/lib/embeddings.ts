// Server-only. Never import into a client component (large native deps).

// Singleton pipeline. First call downloads all-MiniLM-L6-v2 (~90MB) to
// ~/.cache/@xenova/transformers, subsequent calls run in-process.
type ExtractorFn = (text: string | string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<{ data: Float32Array }>;

let _extractor: ExtractorFn | null = null;
let _loading: Promise<ExtractorFn> | null = null;

export const EMBEDDING_DIM = 384;

export async function getEmbedder(): Promise<ExtractorFn> {
  if (_extractor) return _extractor;
  if (_loading) return _loading;
  _loading = (async () => {
    // Dynamic import so Next.js doesn't try to bundle it into edge/client builds
    const { pipeline, env } = await import("@xenova/transformers");
    env.allowLocalModels = true;
    const fn = (await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")) as unknown as ExtractorFn;
    _extractor = fn;
    return fn;
  })();
  return _loading;
}

export async function embed(text: string): Promise<number[]> {
  const extractor = await getEmbedder();
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const extractor = await getEmbedder();
  // The pipeline supports batching natively when passed an array
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  // Output shape: [batch, dim] flattened as Float32Array
  const dim = EMBEDDING_DIM;
  const batch = texts.length;
  const flat = Array.from(out.data);
  const vectors: number[][] = [];
  for (let i = 0; i < batch; i++) vectors.push(flat.slice(i * dim, (i + 1) * dim));
  return vectors;
}

// Format a JS number[] into pgvector literal: '[0.1,0.2,...]'
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
