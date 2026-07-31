const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.0-flash-001';

export type OpenRouterTask = 'rules-qa' | 'image-extract';

const TASK_MODEL_ENV: Record<OpenRouterTask, 'OPENROUTER_MODEL_RULES' | 'OPENROUTER_MODEL_VISION'> = {
  'rules-qa': 'OPENROUTER_MODEL_RULES',
  'image-extract': 'OPENROUTER_MODEL_VISION',
};

// Rough, hand-maintained $/1M-token rates for cost visibility in logs only —
// not wired to OpenRouter's actual billing and not kept in lockstep with their
// pricing page. Unknown models simply log a null estimate.
const MODEL_COST_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  'google/gemini-2.0-flash-001': { input: 0.10, output: 0.40 },
  'google/gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'google/gemini-2.5-pro': { input: 1.25, output: 10.00 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
  'openai/gpt-4o': { input: 2.50, output: 10.00 },
  'anthropic/claude-3.5-haiku': { input: 0.80, output: 4.00 },
};

function configuredModel(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function getOpenRouterModel(task: OpenRouterTask): string {
  return (
    configuredModel(TASK_MODEL_ENV[task]) ??
    configuredModel('OPENROUTER_MODEL') ??
    DEFAULT_OPENROUTER_MODEL
  );
}

function estimateCostUsd(
  model: string,
  promptTokens: number | undefined,
  completionTokens: number | undefined,
): number | null {
  const rates = MODEL_COST_PER_MILLION_TOKENS[model];
  if (!rates || promptTokens === undefined || completionTokens === undefined) return null;
  const cost = (promptTokens / 1_000_000) * rates.input + (completionTokens / 1_000_000) * rates.output;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

function logModelRouting(details: Record<string, unknown>): void {
  console.log(JSON.stringify({ component: 'openrouter', event: 'model_routed', ...details }));
}

function logModelRoutingFailure(details: Record<string, unknown>): void {
  console.error(JSON.stringify({ component: 'openrouter', event: 'model_routing_failed', ...details }));
}

type OpenRouterChatResponse = {
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

function isOpenRouterChatResponse(value: unknown): value is OpenRouterChatResponse {
  if (typeof value !== 'object' || value === null || !('choices' in value)) return false;
  const { choices } = value as { choices: unknown };
  return Array.isArray(choices) && choices.length > 0
    && typeof choices[0] === 'object' && choices[0] !== null
    && typeof (choices[0] as { message?: unknown }).message === 'object';
}

export async function askOpenRouter(
  task: OpenRouterTask,
  systemPrompt: string,
  userQuestion: string,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const model = getOpenRouterModel(task);
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/diese-tech/salbot',
        'X-Title': 'SALbot Rules Assistant',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userQuestion },
        ],
      }),
    });
  } catch (error) {
    logModelRoutingFailure({
      task,
      model,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (!response.ok) {
    const body = await response.text();
    logModelRoutingFailure({
      task,
      model,
      latencyMs: Date.now() - startedAt,
      status: response.status,
    });
    throw new Error(`OpenRouter error ${response.status}: ${body}`);
  }

  let json: OpenRouterChatResponse;
  try {
    const parsed: unknown = await response.json();
    if (!isOpenRouterChatResponse(parsed)) {
      throw new Error('OpenRouter response was missing a usable choices array.');
    }
    json = parsed;
  } catch (error) {
    logModelRoutingFailure({
      task,
      model,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  logModelRouting({
    task,
    model,
    latencyMs: Date.now() - startedAt,
    promptTokens: json.usage?.prompt_tokens ?? null,
    completionTokens: json.usage?.completion_tokens ?? null,
    totalTokens: json.usage?.total_tokens ?? null,
    estimatedCostUsd: estimateCostUsd(model, json.usage?.prompt_tokens, json.usage?.completion_tokens),
  });

  return json.choices[0]?.message?.content ?? '(no response)';
}
