export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export function formatDate(date: string): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours === 0) {
      const minutes = Math.floor(diff / (1000 * 60));
      if (minutes < 1) return 'Just now';
      return `${minutes}m ago`;
    }
    return `${hours}h ago`;
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

export function estimateCost(promptTokens: number, completionTokens: number, modelId: string): string {
  // Cost per 1M tokens (based on OpenRouter pricing)
  const costPer1M: Record<string, { input: number; output: number }> = {
    // Anthropic
    'anthropic/claude-3-haiku': { input: 0.25, output: 1.25 },
    'anthropic/claude-3.5-sonnet': { input: 3, output: 15 },
    // Google
    'google/gemini-pro-1.5': { input: 1.25, output: 5 },
    'google/gemma-4-31b-it:free': { input: 0, output: 0 },
    'google/gemma-4-31b-it': { input: 0.12, output: 0.37 },
    // Meta
    'meta-llama/llama-3.1-70b-instruct': { input: 0.9, output: 0.9 },
    // Mistral
    'mistralai/mistral-large': { input: 2, output: 6 },
    // OpenAI
    'openai/gpt-4o': { input: 2.5, output: 10 },
    'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
    // OpenRouter
    'openrouter/owl-alpha': { input: 0, output: 0 },
    // Z.ai GLM Models
    'z-ai/glm-4-32b': { input: 0.1, output: 0.1 },
    'z-ai/glm-4.5-air': { input: 0.13, output: 0.85 },
    'z-ai/glm-4.5-air:free': { input: 0, output: 0 },
    'z-ai/glm-4.5': { input: 0.6, output: 2.2 },
    'z-ai/glm-4.5v': { input: 0.6, output: 1.8 },
    'z-ai/glm-4.6': { input: 0.43, output: 1.74 },
    'z-ai/glm-4.6v': { input: 0.3, output: 0.9 },
    'z-ai/glm-4.7': { input: 0.4, output: 1.75 },
    'z-ai/glm-4.7-flash': { input: 0.06, output: 0.4 },
    'z-ai/glm-5': { input: 0.6, output: 1.92 },
    'z-ai/glm-5-turbo': { input: 1.2, output: 4 },
    'z-ai/glm-5.1': { input: 0.98, output: 3.08 },
    'z-ai/glm-5v-turbo': { input: 1.2, output: 4 },
  };

  const rates = costPer1M[modelId] || { input: 1, output: 2 };
  const inputCost = (promptTokens / 1000000) * rates.input;
  const outputCost = (completionTokens / 1000000) * rates.output;
  const total = inputCost + outputCost;

  // Handle free models
  if (rates.input === 0 && rates.output === 0) return 'Free';

  if (total < 0.01) return `< $0.01`;
  if (total < 0.1) return `$${total.toFixed(4)}`;
  return `$${total.toFixed(3)}`;
}
