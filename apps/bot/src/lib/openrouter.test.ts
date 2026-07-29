import { afterEach, describe, expect, it } from 'vitest';
import { getOpenRouterModel } from './openrouter';

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
