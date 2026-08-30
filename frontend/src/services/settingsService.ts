export interface AppSettings {
  embeddingBaseUrl: string;
  embeddingApiKey: string;
  embeddingModel: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  /** The LLM's context window, in tokens. When a paper's passages fit (with room
   *  for the question and answer), the whole paper is sent and the model cites the
   *  passages it used; larger papers fall back to top-k retrieval. */
  llmContextTokens: string;
  /** 'yes' (default) = require {answer, sources}; 'no' = ask for the answer only. */
  qaRequireSources: string;
}

const LS_KEY = 'paper-explorer-settings';

const DEFAULT_CONTEXT_TOKENS = 32000;

const DEFAULTS: AppSettings = {
  embeddingBaseUrl: '',
  embeddingApiKey: '',
  embeddingModel: '',
  llmBaseUrl: '',
  llmApiKey: '',
  llmModel: '',
  llmContextTokens: String(DEFAULT_CONTEXT_TOKENS),
  qaRequireSources: 'yes',
};

export function getLlmContextTokens(): number {
  const n = parseInt(getSettings().llmContextTokens, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CONTEXT_TOKENS;
}

export function getQaRequireSources(): boolean {
  return getSettings().qaRequireSources !== 'no';
}

export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

export function hasEmbeddingConfig(): boolean {
  return getSettings().embeddingBaseUrl.trim() !== '';
}

export function hasLLMConfig(): boolean {
  return getSettings().llmBaseUrl.trim() !== '';
}

export function getEmbeddingModelId(): string {
  const s = getSettings();
  return s.embeddingBaseUrl.trim() ? `${s.embeddingBaseUrl}::${s.embeddingModel}` : '';
}
