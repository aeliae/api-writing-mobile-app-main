// Core data types for the creative writing assistant

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  systemPrompt: string;
  storyOutline: string;
}

export interface ChatThread {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  projectId: string;
  threadId: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: string;
  tokens?: number;
}

export interface MemoryEntry {
  id: string;
  projectId: string;
  title: string;
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  name: string;
  mimeType: string;
  size: number;
  content: string;
  enabled: boolean;
  summary?: string;
  keywords?: string[];
  chunkCount?: number;
  processingStatus?: 'ready' | 'processing' | 'error';
  errorMessage?: string;
  includeMode?: 'auto' | 'summary_only' | 'full';
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFileChunk {
  id: string;
  projectId: string;
  fileId: string;
  index: number;
  title?: string;
  content: string;
  summary?: string;
  keywords?: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  openRouterApiKey: string;
  selectedModel: string;
  theme: 'light' | 'dark' | 'system';
}

export interface ApiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: string;
}

export interface ChatResponse {
  message: Message;
  usage: ApiUsage;
}

export const DEFAULT_SYSTEM_PROMPTS = {
  fantasy: `You are a creative writing assistant specializing in fantasy world-building. Help the user craft immersive fantasy worlds with rich lore, complex characters, and compelling magic systems. Provide detailed suggestions that maintain consistency and internal logic.`,
  noir: `You are a gritty noir fiction editor. Help craft hard-boiled narratives with sharp dialogue, atmospheric descriptions, and morally complex characters. Keep prose punchy and tension high.`,
  coach: `You are a supportive creative writing coach. Encourage the writer, provide constructive feedback, and help overcome blocks. Focus on their strengths while gently suggesting improvements. Celebrate their unique voice.`,
  general: `You are a creative writing assistant. Help the writer develop their story, characters, and prose. Be encouraging while providing honest, constructive feedback. Adapt your style to match the genre and tone they're working in.`,
};

export const AVAILABLE_MODELS = [
  { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', provider: 'Anthropic', contextLength: '200K', inputCost: '$0.25', outputCost: '$1.25' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', contextLength: '200K', inputCost: '$3', outputCost: '$15' },
  { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5', provider: 'Google', contextLength: '1M', inputCost: '$1.25', outputCost: '$5' },
  { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (Free)', provider: 'Google', contextLength: '262K', inputCost: 'Free', outputCost: 'Free' },
  { id: 'google/gemma-4-31b-it', name: 'Gemma 4 31B (Paid)', provider: 'Google', contextLength: '262K', inputCost: '$0.12', outputCost: '$0.37' },
  { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', provider: 'Meta', contextLength: '128K', inputCost: '$0.90', outputCost: '$0.90' },
  { id: 'mistralai/mistral-large', name: 'Mistral Large', provider: 'Mistral AI', contextLength: '128K', inputCost: '$2', outputCost: '$6' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI', contextLength: '128K', inputCost: '$2.50', outputCost: '$10' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', contextLength: '128K', inputCost: '$0.15', outputCost: '$0.60' },
  { id: 'openrouter/owl-alpha', name: 'Owl Alpha', provider: 'OpenRouter', contextLength: '1M', inputCost: 'Free', outputCost: 'Free' },
  { id: 'z-ai/glm-4-32b', name: 'GLM-4 32B', provider: 'Z.ai', contextLength: '128K', inputCost: '$0.10', outputCost: '$0.10' },
  { id: 'z-ai/glm-4.5-air', name: 'GLM-4.5 Air', provider: 'Z.ai', contextLength: '131K', inputCost: '$0.13', outputCost: '$0.85' },
  { id: 'z-ai/glm-4.5-air:free', name: 'GLM-4.5 Air (Free)', provider: 'Z.ai', contextLength: '131K', inputCost: 'Free', outputCost: 'Free' },
  { id: 'z-ai/glm-4.5', name: 'GLM-4.5', provider: 'Z.ai', contextLength: '131K', inputCost: '$0.60', outputCost: '$2.20' },
  { id: 'z-ai/glm-4.5v', name: 'GLM-4.5V', provider: 'Z.ai', contextLength: '66K', inputCost: '$0.60', outputCost: '$1.80' },
  { id: 'z-ai/glm-4.6', name: 'GLM-4.6', provider: 'Z.ai', contextLength: '203K', inputCost: '$0.43', outputCost: '$1.74' },
  { id: 'z-ai/glm-4.6v', name: 'GLM-4.6V', provider: 'Z.ai', contextLength: '131K', inputCost: '$0.30', outputCost: '$0.90' },
  { id: 'z-ai/glm-4.7', name: 'GLM-4.7', provider: 'Z.ai', contextLength: '203K', inputCost: '$0.40', outputCost: '$1.75' },
  { id: 'z-ai/glm-4.7-flash', name: 'GLM-4.7 Flash', provider: 'Z.ai', contextLength: '203K', inputCost: '$0.06', outputCost: '$0.40' },
  { id: 'z-ai/glm-5', name: 'GLM-5', provider: 'Z.ai', contextLength: '203K', inputCost: '$0.60', outputCost: '$1.92' },
  { id: 'z-ai/glm-5-turbo', name: 'GLM-5 Turbo', provider: 'Z.ai', contextLength: '203K', inputCost: '$1.20', outputCost: '$4.00' },
  { id: 'z-ai/glm-5.1', name: 'GLM-5.1', provider: 'Z.ai', contextLength: '203K', inputCost: '$0.98', outputCost: '$3.08' },
  { id: 'z-ai/glm-5v-turbo', name: 'GLM-5V Turbo', provider: 'Z.ai', contextLength: '203K', inputCost: '$1.20', outputCost: '$4.00' },
];

export const QUICK_ACTIONS = [
  { id: 'continue', label: 'Continue writing', prompt: 'Please continue the story from where we left off. Maintain the same style and tone.' },
  { id: 'dialogue', label: 'Suggest dialogue', prompt: 'Suggest natural, engaging dialogue for this scene. Make it feel authentic to the characters.' },
  { id: 'setting', label: 'Describe setting', prompt: 'Write a vivid, atmospheric description of the current setting. Engage all the senses.' },
  { id: 'plot-holes', label: 'Find plot holes', prompt: 'Analyze the story so far and identify any potential plot holes, inconsistencies, or areas that need more development.' },
  { id: 'rewrite', label: 'Rewrite last paragraph', prompt: 'Rewrite the last paragraph to improve prose quality, clarity, and emotional impact.' },
];
