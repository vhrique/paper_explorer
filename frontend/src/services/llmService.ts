import { getSettings } from './settingsService';

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function endpoint() {
  const { llmBaseUrl, llmApiKey, llmModel } = getSettings();
  if (!llmBaseUrl.trim()) return null;
  const base = llmBaseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '');
  return { url: `${base}/v1/chat/completions`, key: llmApiKey || 'none', model: llmModel };
}

const HEADERS = (key: string) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${key}`,
  'anthropic-dangerous-direct-browser-access': 'true',
});

export interface ChatOptions {
  signal?: AbortSignal;
  /** Ask the server for a JSON object response (OpenAI / LM Studio "JSON mode"). */
  json?: boolean;
}

/** Non-streaming chat completion. Returns null if no endpoint is configured.
 *  Retries after dropping request params the model rejects (temperature,
 *  response_format) — different OpenAI-compatible models support different sets. */
export async function chat(messages: ChatTurn[], opts: ChatOptions = {}): Promise<string | null> {
  const ep = endpoint();
  if (!ep) return null;

  const body: Record<string, unknown> = { model: ep.model, temperature: 0.2, messages };
  if (opts.json) body.response_format = { type: 'json_object' };

  const post = () =>
    fetch(ep.url, { method: 'POST', headers: HEADERS(ep.key), body: JSON.stringify(body), signal: opts.signal });

  let r = await post();
  for (let i = 0; i < 3 && !r.ok && (r.status === 400 || r.status === 422); i++) {
    const txt = await r.text().catch(() => '');
    let dropped = false;
    if ('temperature' in body && /temperature/i.test(txt)) {
      delete body.temperature;
      dropped = true;
    }
    if ('response_format' in body && /response_format|json/i.test(txt)) {
      delete body.response_format;
      dropped = true;
    }
    if (!dropped) throw new Error(`LLM ${r.status}: ${txt.slice(0, 300)}`);
    r = await post();
  }
  if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
  const j = await r.json();
  return (j.choices?.[0]?.message?.content as string | undefined) ?? null;
}
