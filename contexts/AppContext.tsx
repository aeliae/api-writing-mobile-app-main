import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Project, ChatThread, Message, MemoryEntry, ProjectFile, ProjectFileChunk, Settings } from '@/types';
import * as storage from '@/services/storage';
import { pickAndReadFile } from '@/utils/fileImport';
import { normalizeFileText, chunkText, extractKeywords, createLocalSummary } from '@/utils/fileProcessing';

interface AppContextType {
  // Projects
  projects: Project[];
  currentProject: Project | null;
  loadingProjects: boolean;
  loadProjects: () => Promise<Project[]>;
  selectProject: (project: Project | null) => Promise<void>;
  createProject: (name: string, systemPrompt?: string) => Promise<Project>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  // Threads
  threads: ChatThread[];
  currentThread: ChatThread | null;
  loadingThreads: boolean;
  loadThreads: (projectId: string) => Promise<ChatThread[]>;
  selectThread: (thread: ChatThread | null) => Promise<void>;
  createThread: (projectId: string, title?: string) => Promise<ChatThread>;
  updateThread: (id: string, updates: Partial<ChatThread>) => Promise<void>;
  deleteThread: (id: string) => Promise<void>;

  // Messages
  messages: Message[];
  loadingMessages: boolean;
  loadMessages: (projectId: string, threadId: string) => Promise<void>;
  clearMessages: (threadId: string) => Promise<void>;

  // Memories
  memories: MemoryEntry[];
  loadingMemories: boolean;
  loadMemories: (projectId: string) => Promise<void>;
  createMemory: (projectId: string, title: string, content: string) => Promise<MemoryEntry>;
  updateMemory: (id: string, updates: Partial<MemoryEntry>) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;

  // Project Files
  files: ProjectFile[];
  loadingFiles: boolean;
  loadFiles: (projectId: string) => Promise<void>;
  /** Pick a file from the device, process it, and save it with chunks. Throws FileSizeLimitError on oversized files. */
  createProjectFileFromImport: (projectId: string) => Promise<ProjectFile | null>;
  updateFile: (id: string, updates: Partial<ProjectFile>) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
  loadFileChunks: (fileId: string) => Promise<ProjectFileChunk[]>;

  // Settings
  settings: Settings;
  loadingSettings: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (updates: Partial<Settings>) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(false);

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [currentThread, setCurrentThread] = useState<ChatThread | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);

  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const [settings, setSettings] = useState<Settings>({
    openRouterApiKey: '',
    selectedModel: 'openai/gpt-4o-mini',
    theme: 'system',
  });
  const [loadingSettings, setLoadingSettings] = useState(false);

  const loadProjects = useCallback(async (): Promise<Project[]> => {
    setLoadingProjects(true);
    try {
      const loadedProjects = await storage.getProjects();
      const sortedProjects = loadedProjects.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      setProjects(sortedProjects);
      setCurrentProject(prev => prev ? sortedProjects.find(project => project.id === prev.id) || prev : null);
      return sortedProjects;
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const loadThreads = useCallback(async (projectId: string): Promise<ChatThread[]> => {
    setLoadingThreads(true);
    try {
      let loadedThreads = await storage.getProjectThreads(projectId);
      loadedThreads = Array.isArray(loadedThreads) ? loadedThreads : [];
      if (loadedThreads.length === 0) {
        const mainThread = await storage.createThread(projectId, 'Main Chat');
        loadedThreads = [mainThread];
      }
      setThreads(loadedThreads);
      return loadedThreads;
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  const loadMessages = useCallback(async (projectId: string, threadId: string) => {
    setLoadingMessages(true);
    try {
      const loadedMessages = await storage.getMessages(projectId, threadId);
      setMessages(Array.isArray(loadedMessages) ? loadedMessages : []);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const loadMemories = useCallback(async (projectId: string) => {
    setLoadingMemories(true);
    try {
      const all = await storage.getAllMemories();
      const safeMemories = Array.isArray(all) ? all : [];
      setMemories(safeMemories.filter(m => m.projectId === projectId));
    } finally {
      setLoadingMemories(false);
    }
  }, []);

  const loadFiles = useCallback(async (projectId: string) => {
    setLoadingFiles(true);
    try {
      const loadedFiles = await storage.getProjectFiles(projectId);
      setFiles(Array.isArray(loadedFiles) ? loadedFiles : []);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  const selectThread = useCallback(async (thread: ChatThread | null) => {
    setCurrentThread(thread);
    if (thread) {
      await loadMessages(thread.projectId, thread.id);
    } else {
      setMessages([]);
    }
  }, [loadMessages]);

  const selectProject = useCallback(async (project: Project | null) => {
    setCurrentProject(project);
    if (project) {
      const loadedThreads = await loadThreads(project.id);
      const nextThread = loadedThreads[0] || null;
      setCurrentThread(nextThread);
      await Promise.all([
        nextThread ? loadMessages(project.id, nextThread.id) : Promise.resolve().then(() => setMessages([])),
        loadMemories(project.id),
        loadFiles(project.id),
      ]);
    } else {
      setThreads([]);
      setCurrentThread(null);
      setMessages([]);
      setMemories([]);
      setFiles([]);
    }
  }, [loadFiles, loadMemories, loadMessages, loadThreads]);

  const createProject = useCallback(async (name: string, systemPrompt?: string) => {
    const project = await storage.createProject(name, systemPrompt);
    await loadProjects();
    return project;
  }, [loadProjects]);

  const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
    await storage.updateProject(id, updates);
    await loadProjects();
    if (currentProject?.id === id) {
      setCurrentProject(prev => prev ? { ...prev, ...updates } : null);
    }
  }, [loadProjects, currentProject]);

  const deleteProject = useCallback(async (id: string) => {
    await storage.deleteProject(id);
    await loadProjects();
    if (currentProject?.id === id) {
      setCurrentProject(null);
      setThreads([]);
      setCurrentThread(null);
      setMessages([]);
      setMemories([]);
      setFiles([]);
    }
  }, [loadProjects, currentProject]);

  const createThread = useCallback(async (projectId: string, title?: string) => {
    const thread = await storage.createThread(projectId, title);
    const loadedThreads = await loadThreads(projectId);
    const nextThread = loadedThreads.find(item => item.id === thread.id) || thread;
    if (currentProject?.id === projectId) {
      await selectThread(nextThread);
      await loadProjects();
    }
    return nextThread;
  }, [currentProject, loadProjects, loadThreads, selectThread]);

  const updateThread = useCallback(async (id: string, updates: Partial<ChatThread>) => {
    await storage.updateThread(id, updates);
    if (!currentProject) return;

    const loadedThreads = await loadThreads(currentProject.id);
    const nextCurrentThread = currentThread ? loadedThreads.find(item => item.id === currentThread.id) || null : null;
    setCurrentThread(nextCurrentThread);
    await loadProjects();
  }, [currentProject, currentThread, loadProjects, loadThreads]);

  const deleteThread = useCallback(async (id: string) => {
    const targetThread = threads.find(thread => thread.id === id);
    if (!targetThread) return;

    await storage.deleteThread(id);
    const loadedThreads = await loadThreads(targetThread.projectId);
    const nextThread = loadedThreads[0] || null;

    if (currentProject?.id === targetThread.projectId) {
      setCurrentThread(nextThread);
      if (nextThread) {
        await loadMessages(targetThread.projectId, nextThread.id);
      } else {
        setMessages([]);
      }
      await loadProjects();
    }
  }, [currentProject, loadMessages, loadProjects, loadThreads, threads]);

  const clearMessages = useCallback(async (threadId: string) => {
    const thread = threads.find(item => item.id === threadId) || currentThread;
    await storage.clearThreadMessages(threadId);
    if (thread) {
      await loadMessages(thread.projectId, thread.id);
      await loadThreads(thread.projectId);
      await loadProjects();
    } else {
      setMessages([]);
    }
  }, [currentThread, loadMessages, loadProjects, loadThreads, threads]);

  const createMemory = useCallback(async (projectId: string, title: string, content: string) => {
    const memory = await storage.createMemory(projectId, title, content);
    await loadMemories(projectId);
    return memory;
  }, [loadMemories]);

  const updateMemory = useCallback(async (id: string, updates: Partial<MemoryEntry>) => {
    await storage.updateMemory(id, updates);
    if (currentProject) await loadMemories(currentProject.id);
  }, [loadMemories, currentProject]);

  const deleteMemory = useCallback(async (id: string) => {
    await storage.deleteMemory(id);
    if (currentProject) await loadMemories(currentProject.id);
  }, [loadMemories, currentProject]);

  const createProjectFileFromImport = useCallback(async (projectId: string): Promise<ProjectFile | null> => {
    // May throw FileSizeLimitError — callers should handle it
    const imported = await pickAndReadFile();
    if (!imported) return null;

    const normalized = normalizeFileText(imported.content);
    const summary = createLocalSummary(normalized);
    const keywords = extractKeywords(normalized);
    const rawChunks = chunkText(normalized);

    // Save the file record first (processingStatus = 'processing')
    const file = await storage.createProjectFile(projectId, imported.name, imported.mimeType, imported.size, normalized);

    // Save chunks
    await storage.createFileChunks(projectId, file.id, rawChunks);

    // Update file with processed metadata
    await storage.updateProjectFile(file.id, {
      summary,
      keywords,
      chunkCount: rawChunks.length,
      processingStatus: 'ready',
      includeMode: 'auto',
    });

    await loadFiles(projectId);
    return { ...file, summary, keywords, chunkCount: rawChunks.length, processingStatus: 'ready', includeMode: 'auto' };
  }, [loadFiles]);

  const updateFile = useCallback(async (id: string, updates: Partial<ProjectFile>) => {
    await storage.updateProjectFile(id, updates);
    if (currentProject) await loadFiles(currentProject.id);
  }, [loadFiles, currentProject]);

  const deleteFile = useCallback(async (id: string) => {
    await storage.deleteProjectFile(id);
    if (currentProject) await loadFiles(currentProject.id);
  }, [loadFiles, currentProject]);

  const loadFileChunks = useCallback(async (fileId: string): Promise<ProjectFileChunk[]> => {
    return storage.getFileChunks(fileId);
  }, []);

  const loadSettings = useCallback(async () => {
    setLoadingSettings(true);
    try {
      const loadedSettings = await storage.getSettings();
      setSettings(loadedSettings);
    } finally {
      setLoadingSettings(false);
    }
  }, []);

  const updateSettings = useCallback(async (updates: Partial<Settings>) => {
    await storage.saveSettings(updates);
    setSettings(prev => ({ ...prev, ...updates }));
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const value: AppContextType = {
    projects,
    currentProject,
    loadingProjects,
    loadProjects,
    selectProject,
    createProject,
    updateProject,
    deleteProject,
    threads,
    currentThread,
    loadingThreads,
    loadThreads,
    selectThread,
    createThread,
    updateThread,
    deleteThread,
    messages,
    loadingMessages,
    loadMessages,
    clearMessages,
    memories,
    loadingMemories,
    loadMemories,
    createMemory,
    updateMemory,
    deleteMemory,
    files,
    loadingFiles,
    loadFiles,
    createProjectFileFromImport,
    updateFile,
    deleteFile,
    loadFileChunks,
    settings,
    loadingSettings,
    loadSettings,
    updateSettings,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
