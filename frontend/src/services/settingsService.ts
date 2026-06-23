export interface AppSettings {
  embeddingBaseUrl: string;
  embeddingApiKey: string;
  embeddingModel: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
}

const LS_KEY = 'paper-explorer-settings';

const DEFAULTS: AppSettings = {
  embeddingBaseUrl: '',
  embeddingApiKey: '',
  embeddingModel: '',
  llmBaseUrl: '',
  llmApiKey: '',
  llmModel: '',
};

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
