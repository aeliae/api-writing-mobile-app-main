import AsyncStorage from '@react-native-async-storage/async-storage';
import { Project, ChatThread, Message, MemoryEntry, ProjectFile, ProjectFileChunk, Settings, ApiUsage } from '@/types';
import { generateId } from '@/utils/helpers';

const KEYS = {
  PROJECTS: 'cw_projects',
  THREADS: 'cw_threads',
  MESSAGES: 'cw_messages',
  MESSAGE_THREAD_IDS: 'cw_message_thread_ids',
  MEMORIES: 'cw_memories',
  PROJECT_FILES: 'cw_project_files',
  PROJECT_FILE_CHUNKS: 'cw_project_file_chunks',
  SETTINGS: 'cw_settings',
};

const DEFAULT_THREAD_TITLE = 'Main Chat';

type UnknownRecord = Record<string, unknown>;

export interface StorageDiagnosticsReport {
  generatedAt: string;
  keyStats: {
    allKeyCount: number;
    relevantKeys: string[];
  };
  projects: {
    count: number;
    ids: string[];
  };
  threads: {
    count: number;
    ids: string[];
  };
  legacyMessages: {
    keyPresent: boolean;
    serializedLength: number;
    normalizedMessageCount: number;
  };
  shardedMessages: {
    indexedThreadIds: string[];
    shardThreadIds: string[];
    shardCount: number;
    normalizedMessageCount: number;
    totalSerializedLength: number;
  };
  threadBreakdown: Array<{
    threadId: string;
    projectId: string;
    title: string;
    messageCount: number;
    shardPresent: boolean;
  }>;
  mismatches: {
    threadsWithoutMessages: string[];
    shardThreadIdsWithoutThreadRecord: string[];
    indexedThreadIdsWithoutShard: string[];
    legacyThreadIdsWithoutThreadRecord: string[];
  };
  likelyIssues: string[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseStoredCollection(data: string | null, preferredKeys: string[] = []): unknown[] {
  if (!data) return [];

  const parsed = JSON.parse(data);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (!isRecord(parsed)) {
    return [];
  }

  for (const key of preferredKeys) {
    const candidate = parsed[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }

    if (isRecord(candidate)) {
      const nestedValues = Object.values(candidate);
      if (nestedValues.every(item => isRecord(item))) {
        return nestedValues;
      }
    }
  }

  const values = Object.values(parsed);
  if (values.every(item => isRecord(item))) {
    return values;
  }

  return [];
}

function readString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return undefined;
}

function readText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

function readNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function readDate(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;

    const timestamp = new Date(value).getTime();
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }

  return undefined;
}

function normalizeStoredProject(raw: unknown): Project | null {
  if (!isRecord(raw)) return null;

  const id = readString(raw.id, raw.projectId, raw.project_id);
  const name = readString(raw.name, raw.title);
  if (!id || !name) return null;

  const createdAt = readDate(raw.createdAt, raw.created_at, raw.timestamp) || new Date().toISOString();
  const updatedAt = readDate(raw.updatedAt, raw.updated_at, raw.lastUpdated, raw.timestamp, raw.createdAt) || createdAt;

  return {
    id,
    name,
    createdAt,
    updatedAt,
    systemPrompt: readText(raw.systemPrompt, raw.system_prompt) || '',
    storyOutline: readText(raw.storyOutline, raw.story_outline) || '',
  };
}

function normalizeStoredThread(raw: unknown): ChatThread | null {
  if (!isRecord(raw)) return null;

  const id = readString(raw.id, raw.threadId, raw.thread_id, raw.chatId, raw.chat_id);
  const projectId = readString(raw.projectId, raw.project_id, raw.projectID);
  if (!id || !projectId) return null;

  const createdAt = readDate(raw.createdAt, raw.created_at, raw.timestamp) || new Date().toISOString();
  const updatedAt = readDate(raw.updatedAt, raw.updated_at, raw.lastUpdated, raw.timestamp, raw.createdAt) || createdAt;

  return {
    id,
    projectId,
    title: readString(raw.title, raw.name, raw.threadTitle, raw.chatTitle) || DEFAULT_THREAD_TITLE,
    parentThreadId: readString(raw.parentThreadId, raw.parent_thread_id, raw.parentId),
    branchFromMessageId: readString(raw.branchFromMessageId, raw.branch_from_message_id, raw.fromMessageId),
    createdAt,
    updatedAt,
  };
}

function normalizeStoredRole(value: unknown): Message['role'] | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  if (normalized === 'user' || normalized === 'assistant' || normalized === 'system') {
    return normalized;
  }

  if (normalized === 'human') return 'user';
  if (normalized === 'ai' || normalized === 'bot' || normalized === 'model') return 'assistant';
  return null;
}

function normalizeStoredMessage(raw: unknown, threadProjectMap: Map<string, string>): Message | null {
  if (!isRecord(raw)) return null;

  const id = readString(raw.id, raw.messageId, raw.message_id);
  const threadId = readString(
    raw.threadId,
    raw.thread_id,
    raw.chatId,
    raw.chat_id,
    raw.conversationId,
    raw.conversation_id
  ) || '';
  const projectId = readString(raw.projectId, raw.project_id, raw.projectID) || threadProjectMap.get(threadId);
  const role = normalizeStoredRole(raw.role ?? raw.sender ?? raw.author ?? raw.type);
  const content = readText(raw.content, raw.text, raw.message, raw.body, raw.output);

  if (!id || !projectId || !role || content === undefined) {
    return null;
  }

  const createdAt = readDate(raw.createdAt, raw.created_at, raw.timestamp, raw.date) || new Date().toISOString();
  const tokens = readNumber(raw.tokens, raw.tokenCount, raw.token_count, raw.completionTokens);

  return {
    id,
    projectId,
    threadId,
    role,
    content,
    createdAt,
    ...(tokens !== undefined ? { tokens } : {}),
  };
}

function parseStoredObject<T extends object>(data: string | null, fallback: T): T {
  if (!data) return fallback;

  const parsed = JSON.parse(data);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    return fallback;
  }

  return { ...fallback, ...parsed };
}

function getDefaultBranchTitle(sourceThread: ChatThread, threads: ChatThread[]): string {
  const baseTitle = sourceThread.title.trim() || DEFAULT_THREAD_TITLE;
  const siblingCount = threads.filter(thread => thread.parentThreadId === sourceThread.id).length;
  return `${baseTitle} Branch ${siblingCount + 1}`;
}

function getThreadMessagesStorageKey(threadId: string): string {
  return `cw_messages_thread_${threadId}`;
}

async function getStoredMessageThreadIds(): Promise<string[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.MESSAGE_THREAD_IDS);
    return parseStoredCollection(data, ['threadIds', 'items'])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  } catch (error) {
    console.error('Error loading message thread index:', error);
    return [];
  }
}

async function saveStoredMessageThreadIds(threadIds: string[]): Promise<void> {
  const uniqueThreadIds = Array.from(new Set(threadIds.filter(id => id.trim().length > 0)));
  await AsyncStorage.setItem(KEYS.MESSAGE_THREAD_IDS, JSON.stringify(uniqueThreadIds));
}

async function getKnownMessageThreadIds(): Promise<string[]> {
  const indexedThreadIds = await getStoredMessageThreadIds();
  if (indexedThreadIds.length > 0) {
    return indexedThreadIds;
  }

  try {
    const allKeys = await AsyncStorage.getAllKeys();
    return allKeys
      .filter(key => key.startsWith('cw_messages_thread_'))
      .map(key => key.slice('cw_messages_thread_'.length))
      .filter(threadId => threadId.trim().length > 0);
  } catch (error) {
    console.error('Error scanning message shard keys:', error);
    return [];
  }
}

async function touchProject(projectId: string, updatedAt = new Date().toISOString()): Promise<void> {
  const projects = await getProjects();
  const index = projects.findIndex(p => p.id === projectId);
  if (index === -1) return;

  projects[index] = { ...projects[index], updatedAt };
  await saveProjects(projects);
}

async function getRawThreads(): Promise<ChatThread[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.THREADS);
    return parseStoredCollection(data, ['threads', 'items'])
      .map(normalizeStoredThread)
      .filter((thread): thread is ChatThread => thread !== null);
  } catch (error) {
    console.error('Error loading threads:', error);
    return [];
  }
}

async function saveThreads(threads: ChatThread[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.THREADS, JSON.stringify(threads));
}

async function getRawMessagesFromSerialized(
  data: string | null,
  threadProjectMap: Map<string, string>
): Promise<Message[]> {
  return parseStoredCollection(data, ['messages', 'items'])
    .map(message => normalizeStoredMessage(message, threadProjectMap))
    .filter((message): message is Message => message !== null);
}

async function getRawMessagesFromLegacyStorage(): Promise<Message[]> {
  try {
    const threads = await getRawThreads();
    const threadProjectMap = new Map(threads.map(thread => [thread.id, thread.projectId]));
    const data = await AsyncStorage.getItem(KEYS.MESSAGES);
    return getRawMessagesFromSerialized(data, threadProjectMap);
  } catch (error) {
    console.error('Error loading legacy messages:', error);
    return [];
  }
}

async function getRawMessagesForThread(threadId: string): Promise<Message[] | null> {
  try {
    const threads = await getRawThreads();
    const threadProjectMap = new Map(threads.map(thread => [thread.id, thread.projectId]));
    const data = await AsyncStorage.getItem(getThreadMessagesStorageKey(threadId));
    if (data !== null) {
      return getRawMessagesFromSerialized(data, threadProjectMap);
    }

    const threadIds = await getKnownMessageThreadIds();
    if (threadIds.includes(threadId)) {
      return [];
    }

    return null;
  } catch (error) {
    console.error(`Error loading messages for thread ${threadId}:`, error);
    return null;
  }
}

async function getRawMessages(): Promise<Message[]> {
  const threadIds = await getKnownMessageThreadIds();

  if (threadIds.length > 0) {
    try {
      const threads = await getRawThreads();
      const threadProjectMap = new Map(threads.map(thread => [thread.id, thread.projectId]));
      const entries = await AsyncStorage.multiGet(threadIds.map(getThreadMessagesStorageKey));
      return entries.flatMap(([, data]) => parseStoredCollection(data, ['messages', 'items']))
        .map(message => normalizeStoredMessage(message, threadProjectMap))
        .filter((message): message is Message => message !== null);
    } catch (error) {
      console.error('Error loading sharded messages:', error);
    }
  }

  const legacyMessages = await getRawMessagesFromLegacyStorage();

  if (legacyMessages.length > 0) {
    await saveMessages(legacyMessages);
  }

  return legacyMessages;
}

async function migrateLegacyMessagesToThreads(): Promise<void> {
  const [projects, existingThreads, existingMessages] = await Promise.all([
    getProjects(),
    getRawThreads(),
    getRawMessages(),
  ]);

  if (existingMessages.length === 0) return;

  const threadMap = new Map(existingThreads.map(thread => [thread.id, thread]));
  const projectThreadMap = new Map<string, ChatThread[]>();
  for (const thread of existingThreads) {
    const threads = projectThreadMap.get(thread.projectId) || [];
    threads.push(thread);
    projectThreadMap.set(thread.projectId, threads);
  }

  let threadsChanged = false;
  let messagesChanged = false;
  const nextThreads = [...existingThreads];
  const ensureProjectThread = (projectId: string, preferredThreadId?: string, fallbackDate?: string): ChatThread => {
    const projectThreads = projectThreadMap.get(projectId) || [];

    if (preferredThreadId) {
      const existingThread = threadMap.get(preferredThreadId);
      if (existingThread) {
        return existingThread;
      }
    }

    if (!preferredThreadId && projectThreads.length > 0) {
      return projectThreads[0];
    }

    const project = projects.find(p => p.id === projectId);
    const createdAt = fallbackDate || project?.updatedAt || new Date().toISOString();
    const thread: ChatThread = {
      id: preferredThreadId || generateId(),
      projectId,
      title: DEFAULT_THREAD_TITLE,
      createdAt,
      updatedAt: project?.updatedAt || createdAt,
    };

    nextThreads.push(thread);
    threadMap.set(thread.id, thread);
    projectThreadMap.set(projectId, [...projectThreads, thread]);
    threadsChanged = true;
    return thread;
  };

  const bumpThreadTimestamp = (thread: ChatThread, candidateDate?: string) => {
    if (!candidateDate) return;

    const candidateTime = new Date(candidateDate).getTime();
    const currentTime = new Date(thread.updatedAt).getTime();
    if (Number.isNaN(candidateTime) || candidateTime <= currentTime) return;

    thread.updatedAt = new Date(candidateTime).toISOString();
    threadsChanged = true;
  };

  const nextMessages = existingMessages.map((message) => {
    const fallbackDate = message.createdAt || new Date().toISOString();

    // Recover orphaned messages whose thread ids no longer exist in storage.
    if (message.threadId) {
      const thread = ensureProjectThread(message.projectId, message.threadId, fallbackDate);
      bumpThreadTimestamp(thread, fallbackDate);
      return message;
    }

    const thread = ensureProjectThread(message.projectId, undefined, fallbackDate);
    bumpThreadTimestamp(thread, fallbackDate);

    messagesChanged = true;
    return { ...message, threadId: thread.id };
  });

  if (threadsChanged) {
    await saveThreads(nextThreads);
  }

  if (messagesChanged) {
    await saveMessages(nextMessages);
  }
}

// Project operations
export async function getProjects(): Promise<Project[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.PROJECTS);
    return parseStoredCollection(data, ['projects', 'items'])
      .map(normalizeStoredProject)
      .filter((project): project is Project => project !== null);
  } catch (error) {
    console.error('Error loading projects:', error);
    return [];
  }
}

export async function saveProjects(projects: Project[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.PROJECTS, JSON.stringify(projects));
}

export async function createProject(name: string, systemPrompt?: string): Promise<Project> {
  const projects = await getProjects();
  const newProject: Project = {
    id: generateId(),
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    systemPrompt: systemPrompt || '',
    storyOutline: '',
  };
  projects.push(newProject);
  await saveProjects(projects);
  return newProject;
}

export async function updateProject(id: string, updates: Partial<Project>): Promise<void> {
  const projects = await getProjects();
  const index = projects.findIndex(p => p.id === id);
  if (index !== -1) {
    projects[index] = { ...projects[index], ...updates, updatedAt: new Date().toISOString() };
    await saveProjects(projects);
  }
}

export async function deleteProject(id: string): Promise<void> {
  const projects = await getProjects();
  await saveProjects(projects.filter(p => p.id !== id));
  const threads = await getRawThreads();
  const deletedThreadIds = threads.filter(t => t.projectId === id).map(thread => thread.id);
  await saveThreads(threads.filter(t => t.projectId !== id));
  const messages = await getRawMessages();
  await saveMessages(messages.filter(msg => msg.projectId !== id));
  if (deletedThreadIds.length > 0) {
    await AsyncStorage.multiRemove(deletedThreadIds.map(getThreadMessagesStorageKey));
  }
  const memories = await getAllMemories();
  await saveMemories(memories.filter(m => m.projectId !== id));
  const files = await getAllFiles();
  await saveFiles(files.filter(f => f.projectId !== id));
  const chunks = await getAllFileChunks();
  await saveFileChunks(chunks.filter(c => c.projectId !== id));
}

// Thread operations
export async function getAllThreads(): Promise<ChatThread[]> {
  await migrateLegacyMessagesToThreads();
  return getRawThreads();
}

export async function getProjectThreads(projectId: string): Promise<ChatThread[]> {
  const threads = await getAllThreads();
  return threads
    .filter(thread => thread.projectId === projectId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function createThread(projectId: string, title = DEFAULT_THREAD_TITLE): Promise<ChatThread> {
  const threads = await getAllThreads();
  const timestamp = new Date().toISOString();
  const newThread: ChatThread = {
    id: generateId(),
    projectId,
    title: title.trim() || DEFAULT_THREAD_TITLE,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  threads.push(newThread);
  await saveThreads(threads);
  await touchProject(projectId, timestamp);
  return newThread;
}

export async function createBranchedThread(
  sourceThreadId: string,
  fromMessageId: string,
  title?: string
): Promise<ChatThread> {
  const [threads, allMessages] = await Promise.all([
    getAllThreads(),
    getAllMessages(),
  ]);

  const sourceThread = threads.find(thread => thread.id === sourceThreadId);
  if (!sourceThread) {
    throw new Error('Source chat could not be found.');
  }

  const sourceMessages = allMessages
    .filter(message => message.threadId === sourceThreadId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const cutoffIndex = sourceMessages.findIndex(message => message.id === fromMessageId);

  if (cutoffIndex === -1) {
    throw new Error('Branch point could not be found in this chat.');
  }

  const timestamp = new Date().toISOString();
  const newThread: ChatThread = {
    id: generateId(),
    projectId: sourceThread.projectId,
    title: title?.trim() || getDefaultBranchTitle(sourceThread, threads),
    parentThreadId: sourceThreadId,
    branchFromMessageId: fromMessageId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const copiedMessages = sourceMessages
    .slice(0, cutoffIndex + 1)
    .map((message) => ({
      ...message,
      id: generateId(),
      threadId: newThread.id,
    }));

  await saveThreads([...threads, newThread]);
  await saveMessages([...allMessages, ...copiedMessages]);
  await touchProject(sourceThread.projectId, timestamp);

  return newThread;
}

export async function updateThread(id: string, updates: Partial<ChatThread>): Promise<void> {
  const threads = await getAllThreads();
  const index = threads.findIndex(thread => thread.id === id);
  if (index === -1) return;

  const updatedAt = new Date().toISOString();
  threads[index] = {
    ...threads[index],
    ...updates,
    title: (updates.title ?? threads[index].title).trim() || DEFAULT_THREAD_TITLE,
    updatedAt,
  };

  await saveThreads(threads);
  await touchProject(threads[index].projectId, updatedAt);
}

export async function deleteThread(id: string): Promise<void> {
  const threads = await getRawThreads();
  const thread = threads.find(item => item.id === id);
  if (!thread) return;

  await saveThreads(threads.filter(item => item.id !== id));
  const messages = await getRawMessages();
  await saveMessages(messages.filter(message => message.threadId !== id));
  await touchProject(thread.projectId);
}

// Message operations
export async function getAllMessages(): Promise<Message[]> {
  await migrateLegacyMessagesToThreads();
  return getRawMessages();
}

export async function saveMessages(messages: Message[]): Promise<void> {
  const groupedMessages = new Map<string, Message[]>();

  for (const message of messages) {
    if (!message.threadId) continue;
    const threadMessages = groupedMessages.get(message.threadId) || [];
    threadMessages.push(message);
    groupedMessages.set(message.threadId, threadMessages);
  }

  const nextThreadIds = Array.from(groupedMessages.keys());
  const previousThreadIds = await getStoredMessageThreadIds();
  const staleThreadIds = previousThreadIds.filter(threadId => !groupedMessages.has(threadId));

  await AsyncStorage.multiSet(
    nextThreadIds.map((threadId) => [
      getThreadMessagesStorageKey(threadId),
      JSON.stringify(groupedMessages.get(threadId)),
    ])
  );

  if (staleThreadIds.length > 0) {
    await AsyncStorage.multiRemove(staleThreadIds.map(getThreadMessagesStorageKey));
  }

  await saveStoredMessageThreadIds(nextThreadIds);
}

export async function getMessages(projectId: string, threadId?: string): Promise<Message[]> {
  if (threadId) {
    const threadMessages = await getRawMessagesForThread(threadId);
    if (threadMessages) {
      return threadMessages
        .filter(message => message.projectId === projectId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }
  }

  const allMessages = await getAllMessages();
  return allMessages
    .filter(m => m.projectId === projectId && (!threadId || m.threadId === threadId))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function addMessage(message: Omit<Message, 'id' | 'createdAt'>): Promise<Message> {
  const allMessages = await getAllMessages();
  const newMessage: Message = {
    ...message,
    id: generateId(),
    createdAt: new Date().toISOString(),
  };
  allMessages.push(newMessage);
  await saveMessages(allMessages);
  await updateThread(message.threadId, {});
  await touchProject(message.projectId, newMessage.createdAt);
  return newMessage;
}

export async function updateMessage(id: string, updates: Partial<Message>): Promise<void> {
  const allMessages = await getAllMessages();
  const index = allMessages.findIndex(message => message.id === id);
  if (index === -1) return;

  const currentMessage = allMessages[index];
  allMessages[index] = {
    ...currentMessage,
    ...updates,
    id: currentMessage.id,
    projectId: currentMessage.projectId,
    threadId: currentMessage.threadId,
    createdAt: currentMessage.createdAt,
  };

  await saveMessages(allMessages);
  await updateThread(currentMessage.threadId, {});
  await touchProject(currentMessage.projectId);
}

export async function truncateThreadMessages(threadId: string, fromMessageId: string, inclusive = true): Promise<void> {
  const threadMessages = await getThreadMessages(threadId);
  const cutoffIndex = threadMessages.findIndex(message => message.id === fromMessageId);
  if (cutoffIndex === -1) return;

  const idsToRemove = new Set(
    threadMessages
      .slice(inclusive ? cutoffIndex : cutoffIndex + 1)
      .map(message => message.id)
  );

  const allMessages = await getAllMessages();
  await saveMessages(allMessages.filter(message => !idsToRemove.has(message.id)));

  const threads = await getAllThreads();
  const thread = threads.find(item => item.id === threadId);
  await updateThread(threadId, {});
  if (thread) {
    await touchProject(thread.projectId);
  }
}

export async function clearProjectMessages(projectId: string): Promise<void> {
  const allMessages = await getAllMessages();
  await saveMessages(allMessages.filter(m => m.projectId !== projectId));
  await touchProject(projectId);
}

export async function getThreadMessages(threadId: string): Promise<Message[]> {
  const threadMessages = await getRawMessagesForThread(threadId);
  if (threadMessages) {
    return threadMessages
      .slice()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  const allMessages = await getAllMessages();
  return allMessages
    .filter(message => message.threadId === threadId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function deleteMessage(id: string): Promise<void> {
  const allMessages = await getAllMessages();
  const message = allMessages.find(m => m.id === id);
  if (!message) return;

  await saveMessages(allMessages.filter(m => m.id !== id));
  await updateThread(message.threadId, {});
  await touchProject(message.projectId);
}

export async function clearThreadMessages(threadId: string): Promise<void> {
  const threads = await getAllThreads();
  const thread = threads.find(item => item.id === threadId);
  const allMessages = await getAllMessages();
  await saveMessages(allMessages.filter(message => message.threadId !== threadId));
  if (thread) {
    await updateThread(threadId, {});
  }
}

// Memory operations
export async function getAllMemories(): Promise<MemoryEntry[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.MEMORIES);
    return parseStoredCollection(data, ['memories', 'items']) as MemoryEntry[];
  } catch (error) {
    console.error('Error loading memories:', error);
    return [];
  }
}

export async function saveMemories(memories: MemoryEntry[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.MEMORIES, JSON.stringify(memories));
}

export async function getProjectMemories(projectId: string): Promise<MemoryEntry[]> {
  const memories = await getAllMemories();
  return memories
    .filter(m => m.projectId === projectId && m.enabled)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function createMemory(projectId: string, title: string, content: string): Promise<MemoryEntry> {
  const memories = await getAllMemories();
  const newMemory: MemoryEntry = {
    id: generateId(),
    projectId,
    title,
    content,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  memories.push(newMemory);
  await saveMemories(memories);
  return newMemory;
}

export async function updateMemory(id: string, updates: Partial<MemoryEntry>): Promise<void> {
  const memories = await getAllMemories();
  const index = memories.findIndex(m => m.id === id);
  if (index !== -1) {
    memories[index] = { ...memories[index], ...updates, updatedAt: new Date().toISOString() };
    await saveMemories(memories);
  }
}

export async function deleteMemory(id: string): Promise<void> {
  const memories = await getAllMemories();
  await saveMemories(memories.filter(m => m.id !== id));
}

// Settings operations
export async function getSettings(): Promise<Settings> {
  const defaultSettings: Settings = {
    openRouterApiKey: '',
    selectedModel: 'openai/gpt-4o-mini',
    theme: 'system',
  };

  try {
    const data = await AsyncStorage.getItem(KEYS.SETTINGS);
    return parseStoredObject<Settings>(data, defaultSettings);
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  return defaultSettings;
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  const currentSettings = await getSettings();
  await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify({ ...currentSettings, ...settings }));
}

// API Usage tracking
export async function getApiUsage(): Promise<ApiUsage[]> {
  try {
    const data = await AsyncStorage.getItem('cw_api_usage');
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function recordApiUsage(usage: ApiUsage): Promise<void> {
  const history = await getApiUsage();
  history.push({ ...usage });
  // Keep only last 100 entries
  if (history.length > 100) {
    history.splice(0, history.length - 100);
  }
  await AsyncStorage.setItem('cw_api_usage', JSON.stringify(history));
}

// Project File operations
export async function getAllFiles(): Promise<ProjectFile[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.PROJECT_FILES);
    return parseStoredCollection(data, ['files', 'items']) as ProjectFile[];
  } catch (error) {
    console.error('Error loading project files:', error);
    return [];
  }
}

export async function saveFiles(files: ProjectFile[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.PROJECT_FILES, JSON.stringify(files));
}

export async function getProjectFiles(projectId: string): Promise<ProjectFile[]> {
  const files = await getAllFiles();
  return files.filter(f => f.projectId === projectId);
}

export async function createProjectFile(
  projectId: string,
  name: string,
  mimeType: string,
  size: number,
  content: string
): Promise<ProjectFile> {
  const files = await getAllFiles();
  const newFile: ProjectFile = {
    id: generateId(),
    projectId,
    name,
    mimeType,
    size,
    content,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  files.push(newFile);
  await saveFiles(files);
  return newFile;
}

export async function updateProjectFile(id: string, updates: Partial<ProjectFile>): Promise<void> {
  const files = await getAllFiles();
  const index = files.findIndex(f => f.id === id);
  if (index !== -1) {
    files[index] = { ...files[index], ...updates, updatedAt: new Date().toISOString() };
    await saveFiles(files);
  }
}

export async function deleteProjectFile(id: string): Promise<void> {
  const files = await getAllFiles();
  await saveFiles(files.filter(f => f.id !== id));
  await deleteFileChunks(id);
}

// Project File Chunk operations
export async function getAllFileChunks(): Promise<ProjectFileChunk[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.PROJECT_FILE_CHUNKS);
    return parseStoredCollection(data, ['chunks', 'items']) as ProjectFileChunk[];
  } catch (error) {
    console.error('Error loading file chunks:', error);
    return [];
  }
}

export async function saveFileChunks(chunks: ProjectFileChunk[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.PROJECT_FILE_CHUNKS, JSON.stringify(chunks));
}

export async function getFileChunks(fileId: string): Promise<ProjectFileChunk[]> {
  const chunks = await getAllFileChunks();
  return chunks.filter(c => c.fileId === fileId).sort((a, b) => a.index - b.index);
}

export async function getProjectFileChunks(projectId: string): Promise<ProjectFileChunk[]> {
  const chunks = await getAllFileChunks();
  return chunks.filter(c => c.projectId === projectId).sort((a, b) => a.index - b.index);
}

export async function createFileChunks(
  projectId: string,
  fileId: string,
  rawChunks: Array<{ title?: string; content: string; summary?: string; keywords?: string[] }>
): Promise<ProjectFileChunk[]> {
  const all = await getAllFileChunks();
  const now = new Date().toISOString();
  const newChunks: ProjectFileChunk[] = rawChunks.map((c, index) => ({
    id: generateId(),
    projectId,
    fileId,
    index,
    title: c.title,
    content: c.content,
    summary: c.summary,
    keywords: c.keywords,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }));
  await saveFileChunks([...all, ...newChunks]);
  return newChunks;
}

export async function updateFileChunk(id: string, updates: Partial<ProjectFileChunk>): Promise<void> {
  const chunks = await getAllFileChunks();
  const index = chunks.findIndex(c => c.id === id);
  if (index !== -1) {
    chunks[index] = { ...chunks[index], ...updates, updatedAt: new Date().toISOString() };
    await saveFileChunks(chunks);
  }
}

export async function deleteFileChunks(fileId: string): Promise<void> {
  const chunks = await getAllFileChunks();
  await saveFileChunks(chunks.filter(c => c.fileId !== fileId));
}

function formatExportRole(role: Message['role']): string {
  switch (role) {
    case 'user':
      return 'You';
    case 'assistant':
      return 'Assistant';
    default:
      return 'System';
  }
}

export async function getStorageDiagnostics(): Promise<{
  report: StorageDiagnosticsReport;
  summaryText: string;
  exportText: string;
}> {
  const generatedAt = new Date().toISOString();
  const allKeys = await AsyncStorage.getAllKeys();
  const relevantKeys = allKeys.filter(
    key =>
      key.startsWith('cw_') ||
      key.startsWith('expo-') ||
      key.includes('message')
  ).sort();

  const [projects, threads, indexedThreadIds, legacyMessagesRaw] = await Promise.all([
    getProjects(),
    getRawThreads(),
    getStoredMessageThreadIds(),
    AsyncStorage.getItem(KEYS.MESSAGES),
  ]);

  const shardThreadIds = allKeys
    .filter(key => key.startsWith('cw_messages_thread_'))
    .map(key => key.slice('cw_messages_thread_'.length))
    .filter(threadId => threadId.trim().length > 0)
    .sort();

  const [legacyMessages, shardEntries] = await Promise.all([
    getRawMessagesFromLegacyStorage(),
    shardThreadIds.length > 0
      ? AsyncStorage.multiGet(shardThreadIds.map(getThreadMessagesStorageKey))
      : Promise.resolve([] as [string, string | null][]),
  ]);

  const threadProjectMap = new Map(threads.map(thread => [thread.id, thread.projectId]));
  const shardMessages = shardEntries.flatMap(([, data]) => parseStoredCollection(data, ['messages', 'items']))
    .map(message => normalizeStoredMessage(message, threadProjectMap))
    .filter((message): message is Message => message !== null);

  const messageCountByThreadId = new Map<string, number>();
  for (const message of shardMessages) {
    messageCountByThreadId.set(message.threadId, (messageCountByThreadId.get(message.threadId) || 0) + 1);
  }

  const threadBreakdown = threads.map(thread => ({
    threadId: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    messageCount: messageCountByThreadId.get(thread.id) || 0,
    shardPresent: shardThreadIds.includes(thread.id),
  }));

  const threadsWithoutMessages = threadBreakdown
    .filter(thread => thread.messageCount === 0)
    .map(thread => thread.threadId);
  const shardThreadIdsWithoutThreadRecord = shardThreadIds.filter(threadId => !threadProjectMap.has(threadId));
  const indexedThreadIdsWithoutShard = indexedThreadIds.filter(threadId => !shardThreadIds.includes(threadId));
  const legacyThreadIdsWithoutThreadRecord = Array.from(
    new Set(
      legacyMessages
        .map(message => message.threadId)
        .filter(threadId => !!threadId && !threadProjectMap.has(threadId))
    )
  );

  const likelyIssues: string[] = [];
  if (legacyMessagesRaw && legacyMessagesRaw.length > 250000 && shardThreadIds.length === 0) {
    likelyIssues.push('Large legacy cw_messages blob detected with no thread shards yet. This is a strong candidate for device-specific AsyncStorage read failures.');
  }
  if (threads.length > 0 && threadsWithoutMessages.length === threads.length) {
    likelyIssues.push('All stored thread records currently resolve to zero sharded messages on this device.');
  }
  if (legacyMessages.length > 0 && shardMessages.length === 0) {
    likelyIssues.push('Legacy messages are still present, but no migrated thread shards were detected.');
  }
  if (shardThreadIdsWithoutThreadRecord.length > 0) {
    likelyIssues.push('Some message shard keys exist without matching thread records.');
  }
  if (indexedThreadIdsWithoutShard.length > 0) {
    likelyIssues.push('The shard index references thread ids that do not currently have shard keys.');
  }

  const report: StorageDiagnosticsReport = {
    generatedAt,
    keyStats: {
      allKeyCount: allKeys.length,
      relevantKeys,
    },
    projects: {
      count: projects.length,
      ids: projects.map(project => project.id),
    },
    threads: {
      count: threads.length,
      ids: threads.map(thread => thread.id),
    },
    legacyMessages: {
      keyPresent: legacyMessagesRaw !== null,
      serializedLength: legacyMessagesRaw?.length || 0,
      normalizedMessageCount: legacyMessages.length,
    },
    shardedMessages: {
      indexedThreadIds,
      shardThreadIds,
      shardCount: shardThreadIds.length,
      normalizedMessageCount: shardMessages.length,
      totalSerializedLength: shardEntries.reduce((total, [, value]) => total + (value?.length || 0), 0),
    },
    threadBreakdown,
    mismatches: {
      threadsWithoutMessages,
      shardThreadIdsWithoutThreadRecord,
      indexedThreadIdsWithoutShard,
      legacyThreadIdsWithoutThreadRecord,
    },
    likelyIssues,
  };

  const summaryLines = [
    `Generated: ${generatedAt}`,
    `Projects: ${report.projects.count}`,
    `Threads: ${report.threads.count}`,
    `Legacy cw_messages present: ${report.legacyMessages.keyPresent ? 'yes' : 'no'}`,
    `Legacy cw_messages size: ${report.legacyMessages.serializedLength} chars`,
    `Legacy normalized messages: ${report.legacyMessages.normalizedMessageCount}`,
    `Shard keys found: ${report.shardedMessages.shardCount}`,
    `Indexed shard thread ids: ${report.shardedMessages.indexedThreadIds.length}`,
    `Sharded normalized messages: ${report.shardedMessages.normalizedMessageCount}`,
    `Threads without messages: ${report.mismatches.threadsWithoutMessages.length}`,
    `Shard ids without thread record: ${report.mismatches.shardThreadIdsWithoutThreadRecord.length}`,
    `Index ids without shard: ${report.mismatches.indexedThreadIdsWithoutShard.length}`,
  ];

  if (likelyIssues.length > 0) {
    summaryLines.push('', 'Likely issues:');
    for (const issue of likelyIssues) {
      summaryLines.push(`- ${issue}`);
    }
  }

  const summaryText = summaryLines.join('\n');
  const exportText = `${summaryText}\n\nFull report:\n${JSON.stringify(report, null, 2)}`;

  return {
    report,
    summaryText,
    exportText,
  };
}

// Export conversation as text
export async function exportConversation(projectId: string, threadId: string): Promise<string> {
  await migrateLegacyMessagesToThreads();

  const [projects, threads, messages] = await Promise.all([
    getProjects(),
    getRawThreads(),
    getMessages(projectId, threadId),
  ]);

  const project = projects.find(item => item.id === projectId);
  const thread = threads.find(item => item.id === threadId);

  const lines = [
    `Project: ${project?.name || 'Unknown'}`,
    `Chat: ${thread?.title || DEFAULT_THREAD_TITLE}`,
    `Exported: ${new Date().toLocaleString()}`,
    '========================================',
    '',
  ];

  for (const message of messages) {
    lines.push(`### ${formatExportRole(message.role)}:`);
    lines.push(message.content);
    lines.push('');
  }

  return lines.join('\n');
}
