// One schema per file in config/server/. The server and the agent refuse to start on a file that fails its schema.
const str = { type: 'string', minLength: 1 };
const port = { type: 'integer', minimum: 1, maximum: 65535 };
const strs = { type: 'array', items: { type: 'string' } };
const mode = { enum: ['auto', 'ask', 'deny'] };
const tier = { enum: ['T0', 'T1', 'T2', 'T3'] };
const hhmm = { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' };
const obj = (properties, required = Object.keys(properties), extra = false) => ({ type: 'object', properties, required, additionalProperties: extra });

export const SCHEMAS = {
  'machines.json': obj({
    server: obj({ bind: str, port, origins: strs, url: str }, ['bind', 'port']),
    machines: {
      type: 'object',
      additionalProperties: obj({
        label: str, os: { enum: ['win32', 'darwin'] }, host: str, agentPort: port, workspaceDir: str, tokenFile: str,
        allowedCallers: strs, mac: { type: 'string' },
      }, ['label', 'os', 'host', 'agentPort', 'workspaceDir', 'tokenFile']),
    },
  }),
  'models.json': obj({
    baseUrl: { type: 'string', pattern: '^http://(127\\.0\\.0\\.1|localhost|\\[::1\\])(:\\d+)?(/.*)?$' },
    modelId: str, contextLength: { type: 'integer', minimum: 2048 }, kvCache: str,
    mtp: obj({ enabled: { type: 'boolean' }, flags: strs }),
    concurrency: { type: 'integer', minimum: 1, maximum: 8 },
    thinking: obj({ chat: { type: 'boolean' }, tools: { type: 'boolean' }, digest: { type: 'boolean' }, agent: { type: 'boolean' } }),
    thinkingMethod: { enum: ['chat_template_kwargs', 'no_think', 'request_field'] },
    requestTimeoutMs: { type: 'integer', minimum: 1000 }, maxOutputTokens: { type: 'integer', minimum: 16 },
    preemptInteractive: { type: 'boolean' }, keepThinkInHistory: { type: 'boolean' },
  }, ['baseUrl', 'modelId', 'contextLength', 'concurrency', 'thinking', 'thinkingMethod', 'requestTimeoutMs']),
  'actions.json': obj({
    maxToolsPerRequest: { type: 'integer', minimum: 1, maximum: 40 },
    actions: {
      type: 'array',
      items: obj({
        name: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,48}$' }, description: str, category: str, tier,
        platforms: { type: 'array', items: { enum: ['win32', 'darwin'] }, minItems: 1 },
        enabled: { type: 'boolean' }, params: { type: 'object' }, returns: { type: 'string' },
        primary: { type: 'string' }, mvp: { type: 'boolean' }, internal: { type: 'boolean' }, timeoutMs: { type: 'integer', minimum: 100 },
      }, ['name', 'description', 'category', 'tier', 'platforms', 'enabled', 'params']),
    },
  }, ['actions']),
  'policy.json': obj({
    modes: obj({ chat: obj({ T0: mode, T1: mode, T2: mode, T3: mode }), scheduled: obj({ T0: mode, T1: mode, T2: mode, T3: mode }) }),
    actions: { type: 'object', additionalProperties: mode },
    scheduled_allow: { type: 'object', additionalProperties: strs },
    approvalTimeoutMs: { type: 'integer', minimum: 1000 },
    pendingExpiryMs: { type: 'integer', minimum: 1000 },
    opencode: obj({ allowCommands: strs, destructive: strs, maxCommandLength: { type: 'integer', minimum: 10 }, taskTimeoutMs: { type: 'integer', minimum: 1000 }, version: str }),
    browser: obj({ allowDomains: strs, denyDomains: strs, submitPatterns: strs }),
  }, ['modes', 'approvalTimeoutMs', 'pendingExpiryMs', 'opencode', 'browser']),
  'apps.json': { type: 'object', additionalProperties: obj({ win32: { type: 'string' }, darwin: { type: 'string' }, args: strs }, []) },
  'workspaces.json': { type: 'object', additionalProperties: obj({ apps: strs, urls: strs, folders: strs, closeApps: strs, devCommands: { type: 'object', additionalProperties: strs } }, []) },
  'schedules.json': obj({
    timezone: str, catchUpWindowMinutes: { type: 'integer', minimum: 0 },
    jobs: { type: 'object', additionalProperties: obj({ at: hhmm, everyMinutes: { type: 'integer', minimum: 1 }, enabled: { type: 'boolean' } }, ['enabled']) },
  }),
  'digest.json': obj({
    enabled: { type: 'boolean' }, calendar: { type: 'boolean' }, gmail: { type: 'boolean' }, telemetry: { type: 'boolean' },
    maxThreads: { type: 'integer', minimum: 1 }, maxBodyChars: { type: 'integer', minimum: 100 },
    thresholds: obj({ gpuTempC: { type: 'number' }, cpuLoadPct: { type: 'number' }, memoryPct: { type: 'number' } }),
    google: obj({ clientFile: str, tokenFile: str }),
  }, ['enabled', 'thresholds', 'google']),
  'voice.json': obj({
    enabled: { type: 'boolean' }, mode: { enum: ['push_to_talk', 'wake_word', 'open'] }, languages: strs,
    stt: obj({ url: str, model: str, timeoutMs: { type: 'integer' } }, ['url', 'model']),
    tts: obj({ url: str, model: str, voices: { type: 'object', additionalProperties: { type: 'string' } } }, ['url', 'model', 'voices']),
    vad: obj({ energyThreshold: { type: 'number' }, minSpeechMs: { type: 'integer' }, frameMs: { type: 'integer' } }),
    turn: obj({ silenceMs: { type: 'integer', minimum: 100 }, maxUtteranceMs: { type: 'integer' } }),
  }, ['enabled', 'mode', 'stt', 'tts', 'vad', 'turn']),
  'files.json': obj({ roots: { win32: strs, darwin: strs }, maxReadBytes: { type: 'integer' }, maxListEntries: { type: 'integer' } }, ['roots']),
  'scripts.json': obj({
    scripts: {
      type: 'array',
      items: obj({ name: { type: 'string', pattern: '^[a-z][a-z0-9_-]{1,40}$' }, file: str, sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' }, tier, platform: { enum: ['win32', 'darwin'] }, params: { type: 'object' }, description: { type: 'string' } },
        ['name', 'file', 'sha256', 'tier', 'platform', 'params']),
    },
  }, ['scripts']),
};

export const REQUIRED_FILES = Object.keys(SCHEMAS);
