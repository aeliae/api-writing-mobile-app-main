import { Message, ApiUsage, ChatResponse, MemoryEntry, ProjectFile, ProjectFileChunk, AVAILABLE_MODELS } from '@/types';
import { getSettings, getProjectMemories, getProjectFiles, getProjectFileChunks, addMessage, recordApiUsage } from './storage';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Token/cost safety caps (in characters, ~4 chars per token)
const MAX_KNOWLEDGE_INDEX_CHARS = 6000;
const MAX_RELEVANT_CHUNKS = 5;
const MAX_CHUNK_CONTEXT_CHARS = 20000;
const MAX_FULL_FILE_CHARS = 30000;

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function buildMemoryContext(memories: MemoryEntry[]): string {
  if (memories.length === 0) return '';
  let context = '\n\n## Project Memory & Notes:\n\n';
  for (const memory of memories) {
    context += `### ${memory.title}\n${memory.content}\n\n`;
  }
  return context;
}

function scoreChunk(
  chunk: ProjectFileChunk,
  file: ProjectFile,
  queryTerms: string[]
): number {
  let score = 0;
  const chunkTextLower = chunk.content.toLowerCase();
  const titleLower = (chunk.title || '').toLowerCase();
  const summaryLower = (chunk.summary || '').toLowerCase();
  const fileNameLower = file.name.toLowerCase();
  const chunkKeywords = (chunk.keywords || []).map(k => k.toLowerCase());

  for (const term of queryTerms) {
    if (term.length < 3) continue;
    const t = term.toLowerCase();

    if (fileNameLower.includes(t)) score += 2;
    if (titleLower.includes(t)) score += 5;
    if (summaryLower.includes(t)) score += 4;
    if (chunkKeywords.some(k => k.includes(t))) score += 8;
    if (chunkTextLower.includes(t)) score += 2;
  }

  // Slight boost for shorter chunks so huge chunks don't always win
  if (chunk.content.length < 2000) score += 1;

  return score;
}

function buildQueryTerms(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>
): string[] {
  const recentHistory = conversationHistory.slice(-3).map(m => m.content).join(' ');
  const combined = `${userMessage} ${recentHistory}`;
  return combined
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3);
}

async function buildProjectKnowledgeContext(
  projectId: string,
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<string> {
  const files = await getProjectFiles(projectId);
  const enabledFiles = files.filter(f => f.enabled);
  if (enabledFiles.length === 0) return '';

  const allChunks = await getProjectFileChunks(projectId);
  const queryTerms = buildQueryTerms(userMessage, conversationHistory);

  // Build the knowledge index section (compact overview of all files)
  let indexSection = '\n\n## Project Knowledge Library:\n\n';
  let indexChars = 0;

  for (const file of enabledFiles) {
    const mode = file.includeMode || 'auto';
    const chunkCount = file.chunkCount ?? 1;
    const summary = file.summary || '';
    const keywords = (file.keywords || []).slice(0, 10).join(', ');

    let entry = `**${file.name}** (${chunkCount} chunk${chunkCount !== 1 ? 's' : ''}, mode: ${mode})\n`;
    if (summary) entry += `Summary: ${summary}\n`;
    if (keywords) entry += `Keywords: ${keywords}\n`;
    entry += '\n';

    if (indexChars + entry.length <= MAX_KNOWLEDGE_INDEX_CHARS) {
      indexSection += entry;
      indexChars += entry.length;
    } else {
      indexSection += `**${file.name}** — [index truncated]\n\n`;
    }
  }

  // Build the detailed excerpts section
  let excerptsSection = '';
  let totalExcerptChars = 0;

  for (const file of enabledFiles) {
    const mode = file.includeMode || 'auto';

    if (mode === 'summary_only') {
      if (file.summary) {
        excerptsSection += `\n### ${file.name} — Summary\n${file.summary}\n`;
      }
      continue;
    }

    if (mode === 'full') {
      let content = file.content;
      let truncated = false;
      const available = MAX_FULL_FILE_CHARS - totalExcerptChars;
      if (content.length > available) {
        content = content.slice(0, available);
        truncated = true;
      }
      if (content.trim().length > 0) {
        excerptsSection += `\n### ${file.name} — Full Content${truncated ? ' [TRUNCATED]' : ''}\n${content}\n`;
        totalExcerptChars += content.length;
      }
      if (totalExcerptChars >= MAX_FULL_FILE_CHARS) break;
      continue;
    }

    // auto mode: score and select top relevant chunks
    const fileChunks = allChunks.filter(c => c.fileId === file.id && c.enabled);
    if (fileChunks.length === 0) continue;

    const scored = fileChunks
      .map(chunk => ({ chunk, score: scoreChunk(chunk, file, queryTerms) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RELEVANT_CHUNKS);

    // Only include chunks with a non-zero score, or fall back to first chunk
    const toInclude = scored.some(s => s.score > 0)
      ? scored.filter(s => s.score > 0)
      : [scored[0]];

    // Sort back by original index for coherent reading order
    toInclude.sort((a, b) => a.chunk.index - b.chunk.index);

    for (const { chunk } of toInclude) {
      const available = MAX_CHUNK_CONTEXT_CHARS - totalExcerptChars;
      if (available <= 0) break;

      let content = chunk.content;
      let truncated = false;
      if (content.length > available) {
        content = content.slice(0, available);
        truncated = true;
      }

      const chunkLabel = chunk.title
        ? `${file.name} — ${chunk.title}`
        : `${file.name} — chunk ${chunk.index + 1}`;

      let entry = `\n### ${chunkLabel}${truncated ? ' [TRUNCATED]' : ''}\n`;
      if (chunk.summary) entry += `Summary: ${chunk.summary}\n`;
      if (chunk.keywords && chunk.keywords.length > 0) entry += `Keywords: ${chunk.keywords.slice(0, 8).join(', ')}\n`;
      entry += `Content:\n${content}\n`;

      excerptsSection += entry;
      totalExcerptChars += content.length;
    }

    if (totalExcerptChars >= MAX_CHUNK_CONTEXT_CHARS) break;
  }

  let result = indexSection;
  if (excerptsSection.trim()) {
    result += '\n## Relevant Project File Excerpts\n' + excerptsSection;
  }

  return result;
}

interface SendMessageOptions {
  onChunk?: (accumulatedContent: string) => void;
  skipUserMessage?: boolean;
}

export async function sendMessage(
  projectId: string,
  threadId: string,
  userMessage: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  context?: string,
  options?: SendMessageOptions
): Promise<ChatResponse> {
  const settings = await getSettings();

  if (!settings.openRouterApiKey) {
    throw new ApiError('API key not configured. Please add your OpenRouter API key in Settings.', 'NO_API_KEY');
  }

  const messages: OpenRouterMessage[] = [];

  const memories = await getProjectMemories(projectId);
  const memoryContext = buildMemoryContext(memories);
  const knowledgeContext = await buildProjectKnowledgeContext(projectId, userMessage, conversationHistory);

  let fullSystemPrompt = systemPrompt;
  if (memoryContext) fullSystemPrompt += memoryContext;
  if (knowledgeContext) fullSystemPrompt += knowledgeContext;
  if (context) fullSystemPrompt += '\n\n' + context;

  if (fullSystemPrompt.trim()) {
    messages.push({ role: 'system', content: fullSystemPrompt.trim() });
  }

  for (const msg of conversationHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: 'user', content: userMessage });

  const useStreaming = !!options?.onChunk;
  const onChunk = options?.onChunk;

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.openRouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://creative-writer.app',
        'X-Title': 'Creative Writing Assistant',
      },
      body: JSON.stringify({
        model: settings.selectedModel,
        messages,
        max_tokens: 20000,
        stream: useStreaming,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || `API error: ${response.status}`;
      if (response.status === 401) throw new ApiError('Invalid API key. Please check your OpenRouter API key.', 'INVALID_API_KEY', 401);
      if (response.status === 429) throw new ApiError('Rate limit exceeded. Please wait a moment and try again.', 'RATE_LIMIT', 429);
      if (response.status === 402) throw new ApiError('Insufficient credits. Please add credits to your OpenRouter account.', 'INSUFFICIENT_CREDITS', 402);
      throw new ApiError(errorMessage, 'API_ERROR', response.status);
    }

    let assistantContent = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    if (useStreaming && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const payload = trimmed.slice(6);
            if (payload === '[DONE]') continue;

            try {
              const chunk = JSON.parse(payload);
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta && onChunk) {
                accumulated += delta;
                onChunk(accumulated);
              }
              if (chunk.usage) {
                promptTokens = chunk.usage.prompt_tokens ?? 0;
                completionTokens = chunk.usage.completion_tokens ?? 0;
              }
            } catch {
              // ignore malformed chunks
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      assistantContent = accumulated;
      totalTokens = promptTokens + completionTokens;
    } else {
      const data: OpenRouterResponse = await response.json();
      assistantContent = data.choices[0]?.message?.content || '';
      promptTokens = data.usage?.prompt_tokens || 0;
      completionTokens = data.usage?.completion_tokens || 0;
      totalTokens = data.usage?.total_tokens || promptTokens + completionTokens;
    }

    const usage: ApiUsage = { promptTokens, completionTokens, totalTokens, cost: undefined };

    const model = AVAILABLE_MODELS.find(m => m.id === settings.selectedModel);
    if (model) {
      const { estimateCost } = require('@/utils/helpers');
      usage.cost = estimateCost(promptTokens, completionTokens, settings.selectedModel);
    }

    await recordApiUsage(usage);

    if (!options?.skipUserMessage) {
      await addMessage({ projectId, threadId, role: 'user', content: userMessage, tokens: promptTokens });
    }
    const savedAssistantMessage = await addMessage({
      projectId, threadId, role: 'assistant', content: assistantContent, tokens: completionTokens,
    });

    return { message: savedAssistantMessage, usage };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new ApiError(`Network error: ${errorMessage}. Please check your connection.`, 'NETWORK_ERROR');
  }
}

export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://creative-writer.app',
        'X-Title': 'Creative Writing Assistant',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
      }),
    });
    return response.ok || response.status === 429;
  } catch {
    return false;
  }
}
