import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askOpenRouter, getOpenRouterModel } from './openrouter';

const MODEL_ENV_VARS = [
  'OPENROUTER_MODEL',
  'OPENROUTER_MODEL_RULES',
  'OPENROUTER_MODEL_VISION',
] as const;

const originalEnv = Object.fromEntries(
  MODEL_ENV_VARS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of MODEL_ENV_VARS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('getOpenRouterModel', () => {
  it('routes rules Q&A to the dedicated text model', () => {
    process.env.OPENROUTER_MODEL = 'legacy-model';
    process.env.OPENROUTER_MODEL_RULES = 'rules-model';

    expect(getOpenRouterModel('rules-qa')).toBe('rules-model');
  });

  it('routes image extraction to the dedicated vision model', () => {
    process.env.OPENROUTER_MODEL = 'legacy-model';
    process.env.OPENROUTER_MODEL_VISION = 'vision-model';

    expect(getOpenRouterModel('image-extract')).toBe('vision-model');
  });

  it('falls back to the legacy model for either task', () => {
    delete process.env.OPENROUTER_MODEL_RULES;
    delete process.env.OPENROUTER_MODEL_VISION;
    process.env.OPENROUTER_MODEL = 'legacy-model';

    expect(getOpenRouterModel('rules-qa')).toBe('legacy-model');
    expect(getOpenRouterModel('image-extract')).toBe('legacy-model');
  });

  it('treats an empty task model as unset', () => {
    process.env.OPENROUTER_MODEL_RULES = '   ';
    process.env.OPENROUTER_MODEL = 'legacy-model';

    expect(getOpenRouterModel('rules-qa')).toBe('legacy-model');
  });

  it('uses the stable default when no model variable is configured', () => {
    for (const key of MODEL_ENV_VARS) delete process.env[key];

    expect(getOpenRouterModel('rules-qa')).toBe('google/gemini-2.0-flash-001');
  });
});

describe('askOpenRouter observability', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    for (const key of MODEL_ENV_VARS) delete process.env[key];
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
    vi.restoreAllMocks();
  });

  it('logs which model a task routed to, with token usage and a cost estimate', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'answer' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
      }),
    }) as unknown as typeof fetch;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const answer = await askOpenRouter('rules-qa', 'system', 'question');

    expect(answer).toBe('answer');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(logged).toMatchObject({
      component: 'openrouter',
      event: 'model_routed',
      task: 'rules-qa',
      model: 'google/gemini-2.0-flash-001',
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });
    expect(logged.estimatedCostUsd).toBeCloseTo(0.0003, 6);
    expect(typeof logged.latencyMs).toBe('number');
  });

  it('logs a null cost estimate for a model with no known pricing', async () => {
    process.env.OPENROUTER_MODEL_RULES = 'some/unpriced-model';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'answer' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    }) as unknown as typeof fetch;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await askOpenRouter('rules-qa', 'system', 'question');

    const logged = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(logged.model).toBe('some/unpriced-model');
    expect(logged.estimatedCostUsd).toBeNull();
  });

  it('logs which model a failed call routed to, including the HTTP status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('rate limited'),
    }) as unknown as typeof fetch;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(askOpenRouter('image-extract', 'system', 'question')).rejects.toThrow('OpenRouter error 429');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(logged).toMatchObject({
      component: 'openrouter',
      event: 'model_routing_failed',
      task: 'image-extract',
      model: 'google/gemini-2.0-flash-001',
      status: 429,
    });
  });

  it('logs which model a network failure occurred on', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(askOpenRouter('rules-qa', 'system', 'question')).rejects.toThrow('network down');

    const logged = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(logged).toMatchObject({
      component: 'openrouter',
      event: 'model_routing_failed',
      task: 'rules-qa',
      model: 'google/gemini-2.0-flash-001',
      error: 'network down',
    });
  });
});
