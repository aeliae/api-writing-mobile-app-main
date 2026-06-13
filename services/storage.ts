import AsyncStorage from '@react-native-async-storage/async-storage';
import { Project, ChatThread, Message, MemoryEntry, ProjectFile, ProjectFileChunk, Settings, ApiUsage } from '@/types';
import { generateId } from '@/utils/helpers';

const KEYS = {
  PROJECTS: 'cw_projects',
  THREADS: 'cw_threads',
  MESSAGES: 'cw_messages',
  MEMORIES: 'cw_memories',
  PROJECT_FILES: 'cw_project_files',
  PROJECT_FILE_CHUNKS: 'cw_project_file_chunks',
  SETTINGS: 'cw_settings',
};

const DEFAULT_THREAD_TITLE = 'Main Chat';

function parseStoredArray<T>(data: string | null): T[] {
  if (!data) return [];

  const parsed = JSON.parse(data);
  return Array.isArray(parsed) ? parsed : [];
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
    return parseStoredArray<ChatThread>(data);
  } catch (error) {
    console.error('Error loading threads:', error);
    return [];
  }
}

async function saveThreads(threads: ChatThread[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.THREADS, JSON.stringify(threads));
}

async function getRawMessages(): Promise<Message[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.MESSAGES);
    return parseStoredArray<Message>(data);
  } catch (error) {
    console.error('Error loading messages:', error);
    return [];
  }
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
  const nextMessages = existingMessages.map((message) => {
    // Only migrate truly legacy messages that never had a thread id.
    if (message.threadId) {
      return message;
    }

    let thread = (projectThreadMap.get(message.projectId) || [])[0];

    if (!thread) {
      const project = projects.find(p => p.id === message.projectId);
      const fallbackDate = message.createdAt || new Date().toISOString();
      thread = {
        id: generateId(),
        projectId: message.projectId,
        title: DEFAULT_THREAD_TITLE,
        createdAt: fallbackDate,
        updatedAt: project?.updatedAt || fallbackDate,
      };
      nextThreads.push(thread);
      threadMap.set(thread.id, thread);
      projectThreadMap.set(message.projectId, [thread]);
      threadsChanged = true;
    }

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
    return parseStoredArray<Project>(data);
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
  await saveThreads(threads.filter(t => t.projectId !== id));
  const messages = await getRawMessages();
  await saveMessages(messages.filter(msg => msg.projectId !== id));
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
  await AsyncStorage.setItem(KEYS.MESSAGES, JSON.stringify(messages));
}

export async function getMessages(projectId: string, threadId?: string): Promise<Message[]> {
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
    return parseStoredArray<MemoryEntry>(data);
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
    return parseStoredArray<ProjectFile>(data);
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
    return parseStoredArray<ProjectFileChunk>(data);
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

// Export conversation as text
export async function exportConversation(projectId: string, threadId: string): Promise<string> {
  await migrateLegacyMessagesToThreads();

  const [projects, threads, allMessages] = await Promise.all([
    getProjects(),
    getRawThreads(),
    getRawMessages(),
  ]);

  const project = projects.find(item => item.id === projectId);
  const thread = threads.find(item => item.id === threadId);
  const messages = allMessages
    .filter(message => message.threadId === threadId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

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
