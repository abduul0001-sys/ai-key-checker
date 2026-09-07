import dns from 'node:dns/promises';
import net from 'node:net';

const DEFAULT_TIMEOUT_MS = 12000;

function bearer(key, extra = {}) {
  return { Authorization: `Bearer ${key}`, ...extra };
}

function apiKeyField(label = 'API key') {
  return [{ id: 'apiKey', label, type: 'password', required: true, placeholder: 'Tempel API key' }];
}

function listIds(body) {
  const arrays = [body?.data, body?.models, body?.results, body?.modelSummaries, body?.publisherModels, body?.projects, body?.indexes];
  const source = arrays.find(Array.isArray) || [];
  const ids = source
    .map((x) => x?.id || x?.name || x?.model || x?.modelId || x?.slug || x?.project_id)
    .filter((x) => typeof x === 'string');
  return { count: source.length, sample: ids.slice(0, 10) };
}

function safeAccount(body) {
  const result = {};
  for (const key of ['username', 'name', 'type', 'email', 'tier']) {
    if (typeof body?.[key] === 'string') result[key] = body[key].slice(0, 120);
  }
  return result;
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isPrivateIpv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x))) return false;
  if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
  if (p[0] >= 224) return true;
  return false;
}

function isPrivateIpv6(ip) {
  const s = ip.toLowerCase();
  return s === '::' || s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb');
}

async function assertPublicHttpsUrl(rawUrl, allowedSuffixes = null) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error('Endpoint URL tidak valid.'); }
  if (u.protocol !== 'https:') throw new Error('Endpoint harus memakai HTTPS.');
  const host = u.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Host lokal tidak diizinkan.');
  if (allowedSuffixes && !allowedSuffixes.some((s) => host === s || host.endsWith(`.${s}`))) {
    throw new Error(`Endpoint harus berada pada domain: ${allowedSuffixes.join(', ')}`);
  }
  if (net.isIP(host)) {
    if ((net.isIP(host) === 4 && isPrivateIpv4(host)) || (net.isIP(host) === 6 && isPrivateIpv6(host))) {
      throw new Error('Alamat IP private/lokal tidak diizinkan.');
    }
    return u;
  }
  const resolved = await dns.lookup(host, { all: true, verbatim: true });
  if (!resolved.length) throw new Error('Host tidak dapat di-resolve.');
  for (const r of resolved) {
    if ((r.family === 4 && isPrivateIpv4(r.address)) || (r.family === 6 && isPrivateIpv6(r.address))) {
      throw new Error('Endpoint mengarah ke jaringan private/lokal dan diblokir.');
    }
  }
  return u;
}

function simpleProvider({ name, category, docs, url, headers, summarize = listIds, note, authMode = 'API key' }) {
  return {
    name, category, docs, note, authMode,
    fields: apiKeyField(),
    request: async (c) => ({ url, options: { method: 'GET', headers: headers(c.apiKey) } }),
    summarize
  };
}

export const PROVIDERS = {
  openai: simpleProvider({
    name: 'OpenAI', category: 'LLM / multimodal', docs: 'https://platform.openai.com/docs/api-reference/models/list',
    url: 'https://api.openai.com/v1/models', headers: (k) => bearer(k)
  }),
  anthropic: simpleProvider({
    name: 'Anthropic', category: 'Claude', docs: 'https://docs.anthropic.com/en/api/models-list',
    url: 'https://api.anthropic.com/v1/models', headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' })
  }),
  gemini: simpleProvider({
    name: 'Google Gemini API', category: 'Gemini / AI Studio', docs: 'https://ai.google.dev/api/models',
    url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=20', headers: (k) => ({ 'x-goog-api-key': k })
  }),
  groq: simpleProvider({
    name: 'Groq', category: 'Fast inference', docs: 'https://console.groq.com/docs/api-reference',
    url: 'https://api.groq.com/openai/v1/models', headers: (k) => bearer(k)
  }),
  mistral: simpleProvider({
    name: 'Mistral AI', category: 'LLM', docs: 'https://docs.mistral.ai/api/endpoint/models',
    url: 'https://api.mistral.ai/v1/models', headers: (k) => bearer(k)
  }),
  openrouter: {
    name: 'OpenRouter', category: 'Multi-provider router', docs: 'https://openrouter.ai/docs/api-reference/api-keys/get-current-key', authMode: 'API key', fields: apiKeyField(),
    request: async (c) => ({ url: 'https://openrouter.ai/api/v1/key', options: { method: 'GET', headers: bearer(c.apiKey) } }),
    summarize: (body) => {
      const data = body?.data || {};
      return { keyInfo: {
        label: typeof data.label === 'string' ? data.label.slice(0, 120) : undefined,
        isFreeTier: typeof data.is_free_tier === 'boolean' ? data.is_free_tier : undefined,
        limitRemaining: Number.isFinite(data.limit_remaining) ? data.limit_remaining : undefined,
        expiresAt: typeof data.expires_at === 'string' ? data.expires_at : undefined
      }};
    }
  },
  xai: simpleProvider({
    name: 'xAI', category: 'Grok API', docs: 'https://docs.x.ai/developers/rest-api-reference/inference/models',
    url: 'https://api.x.ai/v1/models', headers: (k) => bearer(k)
  }),
  cohere: simpleProvider({
    name: 'Cohere', category: 'LLM / embeddings / rerank', docs: 'https://docs.cohere.com/reference/list-models',
    url: 'https://api.cohere.com/v1/models?page_size=20', headers: (k) => bearer(k, { 'X-Client-Name': 'AI-Key-Checker' })
  }),
  together: simpleProvider({
    name: 'Together AI', category: 'Open models / inference', docs: 'https://docs.together.ai/reference/models',
    url: 'https://api.together.ai/v1/models', headers: (k) => bearer(k)
  }),
  deepseek: simpleProvider({
    name: 'DeepSeek', category: 'LLM', docs: 'https://api-docs.deepseek.com/api/list-models/',
    url: 'https://api.deepseek.com/models', headers: (k) => bearer(k)
  }),
  fireworks: simpleProvider({
    name: 'Fireworks AI', category: 'Inference / fine-tuning', docs: 'https://docs.fireworks.ai/',
    url: 'https://api.fireworks.ai/inference/v1/models', headers: (k) => bearer(k),
    note: 'Jika provider mengubah endpoint model-list, gunakan Custom OpenAI-Compatible.'
  }),
  cerebras: simpleProvider({
    name: 'Cerebras', category: 'High-speed inference', docs: 'https://inference-docs.cerebras.ai/api-reference/models/list-models',
    url: 'https://api.cerebras.ai/v1/models', headers: (k) => bearer(k)
  }),
  nvidia: simpleProvider({
    name: 'NVIDIA NIM / API Catalog', category: 'LLM / multimodal / NIM', docs: 'https://docs.api.nvidia.com/nim/reference/llm-apis',
    url: 'https://integrate.api.nvidia.com/v1/models', headers: (k) => bearer(k)
  }),
  huggingface: {
    name: 'Hugging Face', category: 'Hub / Inference Providers', docs: 'https://huggingface.co/docs/huggingface_hub/quick-start', authMode: 'Access token', fields: apiKeyField('Access token'),
    request: async (c) => ({ url: 'https://huggingface.co/api/whoami-v2', options: { method: 'GET', headers: bearer(c.apiKey) } }),
    summarize: (body) => ({ account: safeAccount(body) })
  },
  replicate: {
    name: 'Replicate', category: 'Model inference', docs: 'https://replicate.com/docs/reference/http', authMode: 'API token', fields: apiKeyField('API token'),
    request: async (c) => ({ url: 'https://api.replicate.com/v1/account', options: { method: 'GET', headers: bearer(c.apiKey) } }),
    summarize: (body) => ({ account: safeAccount(body) })
  },
  elevenlabs: {
    name: 'ElevenLabs', category: 'Voice / TTS / audio', docs: 'https://elevenlabs.io/docs/api-reference/user/subscription/get', authMode: 'API key', fields: apiKeyField(),
    request: async (c) => ({ url: 'https://api.elevenlabs.io/v1/user/subscription', options: { method: 'GET', headers: { 'xi-api-key': c.apiKey } } }),
    summarize: (body) => ({ account: { tier: body?.tier, characterCount: body?.character_count, characterLimit: body?.character_limit } })
  },
  deepgram: {
    name: 'Deepgram', category: 'Speech-to-text / TTS', docs: 'https://developers.deepgram.com/guides/fundamentals/authenticating', authMode: 'API key', fields: apiKeyField(),
    request: async (c) => ({ url: 'https://api.deepgram.com/v1/auth/token', options: { method: 'GET', headers: { Authorization: `Token ${c.apiKey}` } } }),
    summarize: (body) => ({ keyInfo: safeAccount(body) })
  },
  stability: {
    name: 'Stability AI', category: 'Image generation', docs: 'https://platform.stability.ai/docs/api-reference', authMode: 'API key', fields: apiKeyField(),
    request: async (c) => ({ url: 'https://api.stability.ai/v1/user/balance', options: { method: 'GET', headers: bearer(c.apiKey) } }),
    summarize: (body) => ({ keyInfo: { credits: body?.credits } })
  },
  voyage: {
    name: 'Voyage AI', category: 'Embeddings / rerank', docs: 'https://docs.voyageai.com/reference/list-files', authMode: 'API key', fields: apiKeyField(),
    request: async (c) => ({ url: 'https://api.voyageai.com/v1/files?limit=1', options: { method: 'GET', headers: bearer(c.apiKey) } }),
    summarize: listIds
  },
  siliconflow: simpleProvider({
    name: 'SiliconFlow', category: 'OpenAI-compatible inference', docs: 'https://docs.siliconflow.com/',
    url: 'https://api.siliconflow.cn/v1/models', headers: (k) => bearer(k), note: 'Endpoint profil regional; gunakan Custom OpenAI-Compatible bila akun memakai base URL lain.'
  }),
  moonshot: simpleProvider({
    name: 'Moonshot AI / Kimi', category: 'OpenAI-compatible LLM', docs: 'https://platform.moonshot.ai/docs/',
    url: 'https://api.moonshot.ai/v1/models', headers: (k) => bearer(k), note: 'Untuk akun regional China mungkin base URL berbeda; gunakan Custom OpenAI-Compatible bila perlu.'
  }),
  nebius: simpleProvider({
    name: 'Nebius AI Studio', category: 'OpenAI-compatible inference', docs: 'https://docs.nebius.com/studio/inference/',
    url: 'https://api.studio.nebius.ai/v1/models', headers: (k) => bearer(k)
  }),
  hyperbolic: simpleProvider({
    name: 'Hyperbolic', category: 'OpenAI-compatible inference', docs: 'https://docs.hyperbolic.xyz/',
    url: 'https://api.hyperbolic.xyz/v1/models', headers: (k) => bearer(k), note: 'Gunakan Custom OpenAI-Compatible jika base URL akun berbeda.'
  }),
  vyceai: simpleProvider({
    name: 'Vyce AI', category: 'OpenAI-compatible multi-model proxy', docs: 'https://vyceai.com/',
    url: 'https://vyceai.com/v1/models', headers: (k) => bearer(k),
    note: 'Vyce AI memakai API kompatibel OpenAI. Checker memvalidasi key lewat GET /v1/models tanpa membuat completion, jadi biasanya tidak menghabiskan token generasi.'
  }),

  azure_openai: {
    name: 'Azure OpenAI', category: 'Azure AI / OpenAI', docs: 'https://learn.microsoft.com/en-us/rest/api/azureopenai/models/list', authMode: 'API key + endpoint',
    fields: [
      { id: 'apiKey', label: 'Azure API key', type: 'password', required: true, placeholder: 'Azure OpenAI key' },
      { id: 'endpoint', label: 'Resource endpoint', type: 'url', required: true, placeholder: 'https://RESOURCE.openai.azure.com' }
    ],
    request: async (c) => {
      const u = await assertPublicHttpsUrl(normalizeBaseUrl(c.endpoint), ['openai.azure.com', 'services.ai.azure.com']);
      const url = `${u.toString().replace(/\/$/, '')}/openai/models?api-version=2024-10-21`;
      return { url, options: { method: 'GET', headers: { 'api-key': c.apiKey } } };
    },
    summarize: listIds
  },

  vertex_ai: {
    name: 'Google Vertex AI', category: 'Google Cloud AI', docs: 'https://cloud.google.com/vertex-ai/docs/reference/rest', authMode: 'OAuth access token',
    note: 'Gunakan short-lived OAuth access token (misalnya dari gcloud auth print-access-token), bukan service-account private key.',
    fields: [
      { id: 'accessToken', label: 'OAuth access token', type: 'password', required: true, placeholder: 'ya29....' },
      { id: 'projectId', label: 'Google Cloud Project ID', type: 'text', required: true, placeholder: 'my-project' },
      { id: 'location', label: 'Region', type: 'text', required: true, placeholder: 'us-central1', value: 'us-central1' }
    ],
    request: async (c) => {
      if (!/^[a-z][a-z0-9-]{3,62}$/i.test(c.projectId)) throw new Error('Project ID tidak valid.');
      if (!/^[a-z0-9-]{2,40}$/i.test(c.location)) throw new Error('Region Vertex tidak valid.');
      const url = `https://${c.location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(c.projectId)}/locations/${encodeURIComponent(c.location)}/models?pageSize=1`;
      return { url, options: { method: 'GET', headers: bearer(c.accessToken) } };
    },
    summarize: listIds
  },

  aws_bedrock: {
    name: 'AWS Bedrock', category: 'AWS foundation models', docs: 'https://docs.aws.amazon.com/bedrock/latest/APIReference/API_ListFoundationModels.html', authMode: 'AWS access credentials',
    fields: [
      { id: 'accessKeyId', label: 'AWS Access Key ID', type: 'text', required: true, placeholder: 'AKIA...' },
      { id: 'secretAccessKey', label: 'AWS Secret Access Key', type: 'password', required: true, placeholder: 'Secret access key' },
      { id: 'sessionToken', label: 'AWS Session Token (opsional)', type: 'password', required: false, placeholder: 'Untuk temporary credentials' },
      { id: 'region', label: 'AWS Region', type: 'text', required: true, placeholder: 'us-east-1', value: 'us-east-1' }
    ],
    customCheck: async (c) => {
      if (!/^[a-z]{2}-[a-z]+-\d$/i.test(c.region)) throw new Error('AWS region tidak valid.');
      const { BedrockClient, ListFoundationModelsCommand } = await import('@aws-sdk/client-bedrock');
      const credentials = { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey };
      if (c.sessionToken) credentials.sessionToken = c.sessionToken;
      const client = new BedrockClient({ region: c.region, credentials });
      const started = Date.now();
      try {
        const out = await client.send(new ListFoundationModelsCommand({}));
        const models = out?.modelSummaries || [];
        return {
          provider: { id: 'aws_bedrock', name: 'AWS Bedrock' }, code: 'valid', label: 'Valid', credentialAccepted: true,
          httpStatus: 200, latencyMs: Date.now() - started, checkedAt: new Date().toISOString(),
          count: models.length, sample: models.slice(0, 10).map((m) => m.modelId).filter(Boolean)
        };
      } finally {
        client.destroy();
      }
    }
  },

  custom_openai: {
    name: 'Custom OpenAI-Compatible', category: 'Provider lain / self-hosted public API', docs: 'https://platform.openai.com/docs/api-reference/models/list', authMode: 'Bearer API key + public HTTPS base URL',
    note: 'Untuk provider OpenAI-compatible yang belum ada di daftar. SSRF protection memblokir localhost/private network.',
    fields: [
      { id: 'apiKey', label: 'API key', type: 'password', required: true, placeholder: 'Provider API key' },
      { id: 'baseUrl', label: 'Base URL', type: 'url', required: true, placeholder: 'https://api.provider.com/v1' }
    ],
    request: async (c) => {
      const u = await assertPublicHttpsUrl(normalizeBaseUrl(c.baseUrl));
      const base = u.toString().replace(/\/$/, '');
      const url = base.endsWith('/v1') ? `${base}/models` : `${base}/models`;
      return { url, options: { method: 'GET', headers: bearer(c.apiKey) } };
    },
    summarize: listIds
  }
};

export function publicProviderList() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id, name: p.name, category: p.category, docs: p.docs, fields: p.fields || apiKeyField(), note: p.note || '', authMode: p.authMode || 'API key'
  }));
}

function statusFromHttp(status) {
  if (status >= 200 && status < 300) return { code: 'valid', label: 'Valid', credentialAccepted: true };
  if (status === 401 || status === 498) return { code: 'invalid', label: 'Invalid / unauthorized', credentialAccepted: false };
  if (status === 403) return { code: 'forbidden', label: 'Forbidden / insufficient scope', credentialAccepted: null };
  if (status === 402) return { code: 'billing', label: 'Billing / credits required', credentialAccepted: null };
  if (status === 429) return { code: 'rate_limited', label: 'Rate limited', credentialAccepted: null };
  if (status >= 500) return { code: 'provider_error', label: 'Provider error', credentialAccepted: null };
  return { code: 'rejected', label: 'Request rejected', credentialAccepted: null };
}

function extractError(body) {
  const candidates = [body?.error?.message, body?.error, body?.message, body?.detail, body?.error_description, body?.Message];
  const value = candidates.find((x) => typeof x === 'string');
  return value ? value.slice(0, 500) : undefined;
}

function redact(message, credentials) {
  let out = String(message || '');
  for (const value of Object.values(credentials || {})) {
    if (typeof value === 'string' && value.length >= 4) out = out.split(value).join('[REDACTED]');
  }
  return out.slice(0, 500);
}

function validateCredentials(provider, credentials) {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) throw new Error('credentials wajib berupa object.');
  const clean = {};
  for (const field of provider.fields || apiKeyField()) {
    const raw = credentials[field.id];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (field.required && !value) throw new Error(`${field.label} wajib diisi.`);
    if (value.length > 4096) throw new Error(`${field.label} terlalu panjang.`);
    if (/\r|\n/.test(value)) throw new Error(`${field.label} mengandung line break yang tidak valid.`);
    clean[field.id] = value;
  }
  return clean;
}

export async function checkProvider(providerId, credentials) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error('Unknown provider');
  const clean = validateCredentials(provider, credentials);

  if (provider.customCheck) {
    try { return await provider.customCheck(clean); }
    catch (error) {
      const name = error?.name || '';
      const code = name.includes('AccessDenied') || name.includes('Unauthorized') || error?.$metadata?.httpStatusCode === 403 ? 'forbidden' :
        error?.$metadata?.httpStatusCode === 401 ? 'invalid' : 'network_error';
      return {
        provider: { id: providerId, name: provider.name }, code,
        label: code === 'invalid' ? 'Invalid / unauthorized' : code === 'forbidden' ? 'Forbidden / insufficient scope' : 'Provider / network error',
        credentialAccepted: code === 'invalid' ? false : null,
        httpStatus: error?.$metadata?.httpStatusCode,
        checkedAt: new Date().toISOString(), message: redact(error?.message || name || 'AWS request failed', clean)
      };
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const started = Date.now();
  try {
    const { url, options } = await provider.request(clean);
    const response = await fetch(url, { redirect: 'follow', ...options, signal: controller.signal });
    const latencyMs = Date.now() - started;
    const text = await response.text();
    let body = null;
    if (text) { try { body = JSON.parse(text); } catch { body = null; } }
    const status = statusFromHttp(response.status);
    const result = { provider: { id: providerId, name: provider.name }, ...status, httpStatus: response.status, latencyMs, checkedAt: new Date().toISOString() };
    if (response.ok && body) Object.assign(result, provider.summarize ? provider.summarize(body) : {});
    if (!response.ok) {
      const message = extractError(body) || (text && text.length < 500 ? text : undefined);
      if (message) result.message = redact(message, clean);
    }
    return result;
  } catch (error) {
    const latencyMs = Date.now() - started;
    if (error?.name === 'AbortError') {
      return { provider: { id: providerId, name: provider.name }, code: 'timeout', label: 'Timeout', credentialAccepted: null, latencyMs, checkedAt: new Date().toISOString() };
    }
    return { provider: { id: providerId, name: provider.name }, code: 'network_error', label: 'Network / configuration error', credentialAccepted: null, latencyMs, checkedAt: new Date().toISOString(), message: redact(error?.message || 'Network error', clean) };
  } finally {
    clearTimeout(timeout);
  }
}
