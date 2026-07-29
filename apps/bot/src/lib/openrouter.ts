const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.0-flash-001';

export type OpenRouterTask = 'rules-qa' | 'image-extract';

const TASK_MODEL_ENV: Record<OpenRouterTask, 'OPENROUTER_MODEL_RULES' | 'OPENROUTER_MODEL_VISION'> = {
  'rules-qa': 'OPENROUTER_MODEL_RULES',
  'image-extract': 'OPENROUTER_MODEL_VISION',
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

export async function askOpenRouter(
  task: OpenRouterTask,
  systemPrompt: string,
  userQuestion: string,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const model = getOpenRouterModel(task);

  const response = await fetch(OPENROUTER_API_URL, {
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

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${body}`);
  }

  const json = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  return json.choices[0]?.message?.content ?? '(no response)';
}
