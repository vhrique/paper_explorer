import { getSettings } from './settingsService';

export class EmbeddingNotConfiguredError extends Error {
  constructor() { super('No embedding API configured'); }
}

async function callEmbedding(inputs: string[]): Promise<number[][]> {
  const { embeddingBaseUrl, embeddingApiKey, embeddingModel } = getSettings();
  if (!embeddingBaseUrl.trim()) throw new EmbeddingNotConfiguredError();

  const base = embeddingBaseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '');
  const r = await fetch(`${base}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${embeddingApiKey || 'none'}`,
    },
    body: JSON.stringify({ model: embeddingModel, input: inputs }),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => r.statusText);
    throw new Error(`Embedding API error ${r.status}: ${text}`);
  }

  const json = await r.json();
  if (!Array.isArray(json.data)) {
    throw new Error(
      `Embedding API returned unexpected format (no "data" array). ` +
      `Got: ${JSON.stringify(json).slice(0, 300)}`
    );
  }
  const data = json.data as Array<{ embedding: number[] }>;
  return data.map(d => d.embedding);
}

export async function embedText(text: string): Promise<number[]> {
  const [emb] = await callEmbedding([text]);
  return emb;
}

export async function embedBatch(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const BATCH = 512;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const batch = await callEmbedding(slice);
    results.push(...batch);
    onProgress?.(Math.min(i + BATCH, texts.length), texts.length);
  }
  return results;
}
