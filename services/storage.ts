import AsyncStorage from '@react-native-async-storage/async-storage';
import { Project, Message, MemoryEntry, ProjectFile, ProjectFileChunk, Settings, ApiUsage } from '@/types';
import { generateId } from '@/utils/helpers';

const KEYS = {
  PROJECTS: 'cw_projects',
  MESSAGES: 'cw_messages',
  MEMORIES: 'cw_memories',
  PROJECT_FILES: 'cw_project_files',
  PROJECT_FILE_CHUNKS: 'cw_project_file_chunks',
  SETTINGS: 'cw_settings',
};

// Project operations
export async function getProjects(): Promise<Project[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.PROJECTS);
    return data ? JSON.parse(data) : [];
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
  const messages = await getAllMessages();
  await saveMessages(messages.filter(msg => msg.projectId !== id));
  const memories = await getAllMemories();
  await saveMemories(memories.filter(m => m.projectId !== id));
  const files = await getAllFiles();
  await saveFiles(files.filter(f => f.projectId !== id));
  const chunks = await getAllFileChunks();
  await saveFileChunks(chunks.filter(c => c.projectId !== id));
}

// Message operations
export async function getAllMessages(): Promise<Message[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.MESSAGES);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error loading messages:', error);
    return [];
  }
}

export async function saveMessages(messages: Message[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.MESSAGES, JSON.stringify(messages));
}

export async function getMessages(projectId: string): Promise<Message[]> {
  const allMessages = await getAllMessages();
  return allMessages
    .filter(m => m.projectId === projectId)
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
}

// Memory operations
export async function getAllMemories(): Promise<MemoryEntry[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.MEMORIES);
    return data ? JSON.parse(data) : [];
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
  try {
    const data = await AsyncStorage.getItem(KEYS.SETTINGS);
    if (data) {
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  return {
    openRouterApiKey: '',
    selectedModel: 'openai/gpt-4o-mini',
    theme: 'system',
  };
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
    return data ? JSON.parse(data) : [];
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
    return data ? JSON.parse(data) : [];
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

// Export conversation as text
export async function exportConversation(projectId: string): Promise<string> {
  const project = (await getProjects()).find(p => p.id === projectId);
  const messages = await getMessages(projectId);

  let text = `Project: ${project?.name || 'Unknown'}\n`;
  text += `Exported: ${new Date().toLocaleString()}\n`;
  text += `========================================\n\n`;

  for (const message of messages) {
    const role = message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Assistant' : 'System';
    text += `### ${role}:\n${message.content}\n\n`;
  }

  return text;
}
