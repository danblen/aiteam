// Client-side LLM configuration (API key, model, base URL).
// Stored in localStorage so the server never persists user credentials.

const KEYS = {
  API_KEY: 'aiteam.llm.apiKey',
  BASE_URL: 'aiteam.llm.baseUrl',
  MODEL: 'aiteam.llm.model',
};

const DEFAULTS = {
  BASE_URL: 'https://api.openai.com/v1',
  MODEL: 'gpt-4o-mini',
};

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function getLlmConfig(): LlmConfig {
  try {
    return {
      apiKey: localStorage.getItem(KEYS.API_KEY) || '',
      baseUrl: localStorage.getItem(KEYS.BASE_URL) || DEFAULTS.BASE_URL,
      model: localStorage.getItem(KEYS.MODEL) || DEFAULTS.MODEL,
    };
  } catch {
    return { apiKey: '', baseUrl: DEFAULTS.BASE_URL, model: DEFAULTS.MODEL };
  }
}

export function saveLlmConfig(config: Partial<LlmConfig>) {
  try {
    if (config.apiKey !== undefined) localStorage.setItem(KEYS.API_KEY, config.apiKey);
    if (config.baseUrl !== undefined) localStorage.setItem(KEYS.BASE_URL, config.baseUrl);
    if (config.model !== undefined) localStorage.setItem(KEYS.MODEL, config.model);
  } catch {
    // localStorage may be unavailable (privacy mode, storage full, etc.)
  }
}

export function clearLlmConfig() {
  try {
    localStorage.removeItem(KEYS.API_KEY);
    localStorage.removeItem(KEYS.BASE_URL);
    localStorage.removeItem(KEYS.MODEL);
  } catch {
    // ignore
  }
}
