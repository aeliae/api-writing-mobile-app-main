import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Share,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import {
  Send,
  Trash2,
  Download,
  Settings,
  Brain,
  Pen,
  ChevronDown,
  Sparkles,
  FolderOpen,
  Plus,
  MoreVertical,
  RotateCcw,
  X,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useApp } from '@/contexts/AppContext';
import { Button, EmptyState, LoadingIndicator, Modal, FilesPanel, Input } from '@/components';
import { requestMessageCompletion, ApiError, MessageCompletionResult } from '@/services/api';
import { formatTokens, formatDate } from '@/utils/helpers';
import { Message, ChatThread, QUICK_ACTIONS } from '@/types';
import * as storage from '@/services/storage';
import { FileSizeLimitError, UnsupportedFileTypeError } from '@/utils/fileImport';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type TabType = 'chat' | 'memory' | 'tools' | 'files';
type ToolsSubTab = 'outline' | 'scenes' | 'quick';

interface ChatMessageProps {
  message: Message;
  colors: any;
  isUser: boolean;
  canEdit?: boolean;
  canRegenerate?: boolean;
  disabled?: boolean;
  onEdit?: (message: Message) => void;
  onRegenerate?: (message: Message) => void;
}

interface MessageRewritePreview {
  truncateFromMessageId: string;
  truncateInclusive: boolean;
  updatedMessage?: {
    id: string;
    content: string;
  };
}

function createTemporaryMessage(
  projectId: string,
  threadId: string,
  role: 'user' | 'assistant',
  content: string
): Message {
  return {
    id: `temp-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    projectId,
    threadId,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

function buildPreviewMessages(messages: Message[], preview: MessageRewritePreview | null): Message[] {
  let nextMessages = messages;

  if (preview) {
    const cutoffIndex = messages.findIndex(message => message.id === preview.truncateFromMessageId);
    if (cutoffIndex !== -1) {
      nextMessages = messages.filter((_, index) =>
        preview.truncateInclusive ? index < cutoffIndex : index <= cutoffIndex
      );
    }
  }

  if (!preview?.updatedMessage) return nextMessages;

  return nextMessages.map(message =>
    message.id === preview.updatedMessage?.id
      ? { ...message, content: preview.updatedMessage.content }
      : message
  );
}

function ChatMessage({
  message,
  colors,
  isUser,
  canEdit,
  canRegenerate,
  disabled,
  onEdit,
  onRegenerate,
}: ChatMessageProps) {
  if (isUser) {
    // User — warm surface panel with blue left accent
    return (
      <View style={{
        padding: 14,
        marginVertical: 8,
        backgroundColor: colors.proseUserBg,
        borderRadius: 8,
        borderLeftWidth: 3,
        borderLeftColor: colors.proseUserAccent,
      }}>
        <Text style={{
          fontSize: 11,
          fontWeight: '600',
          color: colors.textSecondary,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 8,
        }}>You</Text>
        <Text style={{
          fontSize: 15,
          lineHeight: 24,
          color: colors.proseUserText,
        }}>{message.content}</Text>
        {canEdit && onEdit ? (
          <View style={styles.messageActionRow}>
            <TouchableOpacity
              style={[styles.messageActionButton, { backgroundColor: colors.surfaceSecondary, opacity: disabled ? 0.6 : 1 }]}
              onPress={() => onEdit(message)}
              disabled={disabled}
            >
              <Pen size={14} color={colors.textSecondary} />
              <Text style={[styles.messageActionText, { color: colors.textSecondary }]}>Edit & rerun</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  }

  // AI — full-width serif prose, amber dot label
  return (
    <View style={{
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    }}>
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 10,
      }}>
        <View style={{
          width: 6, height: 6,
          borderRadius: 3,
          backgroundColor: colors.proseAiAccent,
        }} />
        <Text style={{
          fontSize: 11,
          fontWeight: '600',
          color: colors.textSecondary,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>Assistant</Text>
        {message.tokens && (
          <Text style={{
            fontSize: 10,
            color: colors.textTertiary,
            marginLeft: 'auto',
          }}>{formatTokens(message.tokens)} tokens</Text>
        )}
      </View>
      <Text style={{
        fontFamily: 'Cormorant_400Regular',  // or just 'Cormorant' if loaded differently
        fontSize: 16.5,
        lineHeight: 28,  // ~1.72 ratio
        color: colors.proseAiText,
      }}>{message.content}</Text>
      {canRegenerate && onRegenerate ? (
        <View style={styles.messageActionRow}>
          <TouchableOpacity
            style={[styles.messageActionButton, { backgroundColor: colors.surfaceSecondary, opacity: disabled ? 0.6 : 1 }]}
            onPress={() => onRegenerate(message)}
            disabled={disabled}
          >
            <RotateCcw size={14} color={colors.textSecondary} />
            <Text style={[styles.messageActionText, { color: colors.textSecondary }]}>Regenerate</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const {
    projects, loadProjects, selectProject, currentProject,
    threads, currentThread, loadingThreads, loadThreads, selectThread, createThread, updateThread, deleteThread,
    messages, loadMessages, clearMessages,
    files, loadingFiles, createProjectFileFromImport, updateFile, deleteFile: deleteProjectFile, loadFileChunks,
    settings, updateProject,
  } = useApp();

  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [messageRewritePreview, setMessageRewritePreview] = useState<MessageRewritePreview | null>(null);
  const [optimisticUserMessage, setOptimisticUserMessage] = useState<Message | null>(null);
  const [streamingAssistantText, setStreamingAssistantText] = useState('');
  const [currentTab, setCurrentTab] = useState<TabType>('chat');
  const [toolsTab, setToolsTab] = useState<ToolsSubTab>('outline');
  const [lastUsage, setLastUsage] = useState<{ promptTokens: number; completionTokens: number; total: number } | null>(null);
  const [systemPromptModalVisible, setSystemPromptModalVisible] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [threadPickerVisible, setThreadPickerVisible] = useState(false);
  const [threadActionsVisible, setThreadActionsVisible] = useState(false);
  const [threadEditorVisible, setThreadEditorVisible] = useState(false);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [threadTitleDraft, setThreadTitleDraft] = useState('');
  const [generatingOutline, setGeneratingOutline] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const displayedMessages = buildPreviewMessages(messages, messageRewritePreview);

  useFocusEffect(
    useCallback(() => {
      loadProjects();
    }, [loadProjects])
  );

  useEffect(() => {
    if (!id || typeof id !== 'string') return;

    const project = projects.find((item) => item.id === id);
    if (project && currentProject?.id !== project.id) {
      void selectProject(project);
    }
  }, [currentProject?.id, id, projects, selectProject]);

  useEffect(() => {
    if (displayedMessages.length > 0 || optimisticUserMessage || streamingAssistantText) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: false });
      }, 100);
    }
  }, [displayedMessages.length, optimisticUserMessage, streamingAssistantText]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const resetTransientThreadState = useCallback(() => {
    setEditingMessageId(null);
    setMessageRewritePreview(null);
    setOptimisticUserMessage(null);
    setStreamingAssistantText('');
  }, []);

  useEffect(() => {
    const resetTimer = setTimeout(() => {
      resetTransientThreadState();
    }, 0);

    return () => clearTimeout(resetTimer);
  }, [currentThread?.id, resetTransientThreadState]);

  const buildConversationHistory = useCallback((sourceMessages: Message[]) => {
    return sourceMessages
      .filter(message => message.role !== 'system')
      .map(message => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      }));
  }, []);

  const refreshThreadState = useCallback(async (projectId: string, threadId: string) => {
    await loadMessages(projectId, threadId);
    await loadThreads(projectId);
    await loadProjects();
  }, [loadMessages, loadProjects, loadThreads]);

  const runAssistantRequest = useCallback(async ({
    userMessage,
    conversationHistory,
    showOptimisticUser,
    preview,
    onPersistSuccess,
    onSuccess,
  }: {
    userMessage: string;
    conversationHistory: { role: 'user' | 'assistant'; content: string }[];
    showOptimisticUser: boolean;
    preview?: MessageRewritePreview | null;
    onPersistSuccess: (result: MessageCompletionResult) => Promise<void>;
    onSuccess?: () => void;
  }) => {
    if (!currentProject || !currentThread) return;

    setInputText('');
    setIsLoading(true);
    setError(null);
    setLastUsage(null);
    setStreamingAssistantText('');
    setMessageRewritePreview(preview || null);
    setOptimisticUserMessage(
      showOptimisticUser
        ? createTemporaryMessage(currentProject.id, currentThread.id, 'user', userMessage)
        : null
    );

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const result = await requestMessageCompletion(
        currentProject.id,
        currentThread.id,
        userMessage,
        systemPrompt,
        conversationHistory,
        undefined,
        {
          signal: controller.signal,
          onChunk: (content) => {
            setStreamingAssistantText(content);
          },
        }
      );

      await onPersistSuccess(result);
      setLastUsage({
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        total: result.usage.totalTokens,
      });
      await refreshThreadState(currentProject.id, currentThread.id);
      setOptimisticUserMessage(null);
      setStreamingAssistantText('');
      setMessageRewritePreview(null);
      onSuccess?.();
    } catch (err) {
      setInputText(userMessage);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
      setOptimisticUserMessage(null);
      setStreamingAssistantText('');
      setMessageRewritePreview(null);
    } finally {
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  }, [currentProject, currentThread, refreshThreadState, systemPrompt]);

  const handleSendMessage = async (contextPrompt?: string) => {
    const messageText = contextPrompt || inputText.trim();
    if (!messageText || !currentProject || !currentThread || isLoading) return;

    if (!settings.openRouterApiKey) {
      Alert.alert('API Key Required', 'Please configure your OpenRouter API key in Settings.');
      return;
    }

    const editingMessage = editingMessageId
      ? messages.find(message => message.id === editingMessageId && message.role === 'user')
      : null;

    if (editingMessage) {
      const editingIndex = messages.findIndex(message => message.id === editingMessage.id);
      const conversationHistory = buildConversationHistory(messages.slice(0, editingIndex));

      await runAssistantRequest({
        userMessage: messageText,
        conversationHistory,
        showOptimisticUser: false,
        preview: {
          truncateFromMessageId: editingMessage.id,
          truncateInclusive: false,
          updatedMessage: {
            id: editingMessage.id,
            content: messageText,
          },
        },
        onPersistSuccess: async (result) => {
          await storage.updateMessage(editingMessage.id, {
            content: messageText,
            tokens: result.usage.promptTokens,
          });
          await storage.truncateThreadMessages(currentThread.id, editingMessage.id, false);
          await storage.addMessage({
            projectId: currentProject.id,
            threadId: currentThread.id,
            role: 'assistant',
            content: result.content,
            tokens: result.usage.completionTokens,
          });
        },
        onSuccess: () => {
          setEditingMessageId(null);
        },
      });
      return;
    }

    const conversationHistory = buildConversationHistory(messages);
    await runAssistantRequest({
      userMessage: messageText,
      conversationHistory,
      showOptimisticUser: true,
      onPersistSuccess: async (result) => {
        await storage.addMessage({
          projectId: currentProject.id,
          threadId: currentThread.id,
          role: 'user',
          content: messageText,
          tokens: result.usage.promptTokens,
        });
        await storage.addMessage({
          projectId: currentProject.id,
          threadId: currentThread.id,
          role: 'assistant',
          content: result.content,
          tokens: result.usage.completionTokens,
        });
      },
    });
  };

  const handleQuickAction = (action: typeof QUICK_ACTIONS[0]) => {
    handleSendMessage(action.prompt);
  };

  const handleStartEditMessage = (message: Message) => {
    if (isLoading) return;

    const messageIndex = messages.findIndex(item => item.id === message.id);
    const laterMessageCount = messageIndex === -1 ? 0 : messages.length - messageIndex - 1;

    const startEditing = () => {
      setEditingMessageId(message.id);
      setInputText(message.content);
      setError(null);
      setCurrentTab('chat');
      setTimeout(() => inputRef.current?.focus(), 0);
    };

    if (laterMessageCount > 0) {
      Alert.alert(
        'Edit and rerun',
        `Sending this edit will replace this message and remove ${laterMessageCount} later ${laterMessageCount === 1 ? 'message' : 'messages'} in this chat.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue', onPress: startEditing },
        ]
      );
      return;
    }

    startEditing();
  };

  const handleCancelEditing = () => {
    setEditingMessageId(null);
    setInputText('');
  };

  const handleRegenerateMessage = async (message: Message) => {
    if (!currentProject || !currentThread || isLoading) return;

    const assistantIndex = messages.findIndex(item => item.id === message.id);
    if (assistantIndex === -1) return;

    const previousUserIndex = [...messages]
      .slice(0, assistantIndex)
      .reverse()
      .findIndex(item => item.role === 'user');

    if (previousUserIndex === -1) {
      Alert.alert('Cannot Regenerate', 'This reply does not have a user message to rerun from.');
      return;
    }

    const userIndex = assistantIndex - previousUserIndex - 1;
    const sourceUserMessage = messages[userIndex];
    if (!sourceUserMessage || sourceUserMessage.role !== 'user') return;

    const laterMessageCount = messages.length - assistantIndex - 1;

    const regenerate = async () => {
      setEditingMessageId(null);
      setInputText('');

      await runAssistantRequest({
        userMessage: sourceUserMessage.content,
        conversationHistory: buildConversationHistory(messages.slice(0, userIndex)),
        showOptimisticUser: false,
        preview: {
          truncateFromMessageId: message.id,
          truncateInclusive: true,
        },
        onPersistSuccess: async (result) => {
          await storage.updateMessage(sourceUserMessage.id, {
            tokens: result.usage.promptTokens,
          });
          await storage.truncateThreadMessages(currentThread.id, message.id, true);
          await storage.addMessage({
            projectId: currentProject.id,
            threadId: currentThread.id,
            role: 'assistant',
            content: result.content,
            tokens: result.usage.completionTokens,
          });
        },
      });
    };

    if (laterMessageCount > 0) {
      Alert.alert(
        'Regenerate reply',
        `This will replace this reply and remove ${laterMessageCount} later ${laterMessageCount === 1 ? 'message' : 'messages'} in this chat.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Regenerate', onPress: () => { void regenerate(); } },
        ]
      );
      return;
    }

    await regenerate();
  };

  const handleClearHistory = () => {
    if (!currentThread) return;

    Alert.alert(
      'Clear Conversation',
      `Are you sure you want to clear "${currentThread.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearMessages(currentThread.id);
          },
        },
      ]
    );
  };

  const handleExport = async () => {
    if (!currentProject || !currentThread) return;

    try {
      const text = await storage.exportConversation(currentProject.id, currentThread.id);
      if (!text.trim()) {
        Alert.alert('Nothing to Export', 'This conversation is empty.');
        return;
      }

      if (Platform.OS === 'web') {
        await navigator.clipboard?.writeText(text);
        Alert.alert('Copied', 'Conversation copied to clipboard');
        return;
      }

      await Share.share({
        message: text,
        title: `${currentProject.name} conversation export`,
      });
    } catch (error) {
      console.error('Error exporting conversation:', error);
      Alert.alert('Export Failed', 'Could not export this conversation. Please try again.');
    }
  };

  const handleSaveSystemPrompt = async () => {
    if (!currentProject) return;
    await updateProject(currentProject.id, { systemPrompt });
    setSystemPromptModalVisible(false);
  };

  const openNewThreadModal = () => {
    setEditingThreadId(null);
    setThreadTitleDraft(`Chat ${threads.length + 1}`);
    setThreadPickerVisible(false);
    setThreadActionsVisible(false);
    setThreadEditorVisible(true);
  };

  const openRenameThreadModal = () => {
    if (!currentThread) return;

    setEditingThreadId(currentThread.id);
    setThreadTitleDraft(currentThread.title);
    setThreadActionsVisible(false);
    setThreadEditorVisible(true);
  };

  const handleSaveThread = async () => {
    if (!currentProject) return;

    const title = threadTitleDraft.trim() || `Chat ${threads.length + 1}`;
    if (editingThreadId) {
      await updateThread(editingThreadId, { title });
    } else {
      await createThread(currentProject.id, title);
    }

    setThreadEditorVisible(false);
    setEditingThreadId(null);
    setThreadTitleDraft('');
  };

  const handleSelectThread = async (thread: ChatThread) => {
    setThreadPickerVisible(false);
    await selectThread(thread);
  };

  const handleDeleteCurrentThread = () => {
    if (!currentThread) return;

    Alert.alert(
      'Delete Chat',
      `Delete "${currentThread.title}" and all of its messages? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setThreadActionsVisible(false);
            setThreadPickerVisible(false);
            await deleteThread(currentThread.id);
          },
        },
      ]
    );
  };

  const handleImportFile = async () => {
    if (!currentProject) return;

    try {
      const imported = await createProjectFileFromImport(currentProject.id);

      if (imported) {
        Alert.alert('File Imported', `"${imported.name}" was added to this project.`);
      }
    } catch (err) {
      if (err instanceof FileSizeLimitError || err instanceof UnsupportedFileTypeError) {
        Alert.alert('Import Failed', err.message);
      } else if (err instanceof Error) {
        Alert.alert('Import Failed', err.message);
      } else {
        Alert.alert('Import Failed', 'Could not read the file. Please try another text file.');
      }
    }
  };

  // Tools handlers
  const handleGenerateOutline = async () => {
    if (!currentProject || !currentThread || isLoading || generatingOutline) return;

    if (!settings.openRouterApiKey) {
      Alert.alert('API Key Required', 'Please configure your OpenRouter API key in Settings.');
      return;
    }

    const outlinePrompt = `Generate a structured story outline for this writing project. Use the current chat, memory notes, imported reference files, and project prompt as the source of truth.

Include:
- Key story beats
- Character development moments
- Major plot points
- Estimated length or pacing guidance

Structure the response with:
- Act 1
- Act 2A
- Act 2B
- Act 3

If important details are missing, make only light assumptions and label them clearly. Return only the outline in markdown.`;

    setGeneratingOutline(true);
    setError(null);

    try {
      const conversationHistory = buildConversationHistory(messages);
      const result = await requestMessageCompletion(
        currentProject.id,
        currentThread.id,
        outlinePrompt,
        systemPrompt,
        conversationHistory
      );

      await updateProject(currentProject.id, { storyOutline: result.content });
      setLastUsage({
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        total: result.usage.totalTokens,
      });
      Alert.alert('Outline Ready', 'A fresh outline was generated and saved to this project.');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred while generating the outline.');
      }
    } finally {
      setGeneratingOutline(false);
    }
  };

  const handleSuggestScenes = async () => {
    const scenePrompt = `Based on the story so far, suggest 3-5 possible next scenes. For each scene:
- Give a brief description
- Note the emotional tone
- Explain how it advances the plot
Consider pacing, tension building, and character development.`;
    setInputText(scenePrompt);
  };

  if (!currentProject) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <LoadingIndicator fullScreen />
      </View>
    );
  }

  const editingMessage = editingMessageId
    ? messages.find(message => message.id === editingMessageId && message.role === 'user') || null
    : null;

  const renderChat = () => (
    <KeyboardAvoidingView
      style={styles.chatContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      <View style={[styles.threadBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.threadSelector, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => setThreadPickerVisible(true)}
          disabled={loadingThreads || isLoading}
        >
          <View style={styles.threadSelectorText}>
            <Text style={[styles.threadLabel, { color: colors.textSecondary }]}>Current Chat</Text>
            <Text style={[styles.threadTitle, { color: colors.text }]} numberOfLines={1}>
              {currentThread?.title || (loadingThreads ? 'Loading chats...' : 'Main Chat')}
            </Text>
          </View>
          <ChevronDown size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.threadQuickButton, { backgroundColor: colors.primaryLight }]}
          onPress={openNewThreadModal}
          disabled={isLoading}
        >
          <Plus size={16} color={colors.primary} />
          <Text style={[styles.threadQuickButtonText, { color: colors.primary }]}>New Chat</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.threadIconButton, { backgroundColor: colors.surfaceSecondary }]}
          onPress={() => setThreadActionsVisible(true)}
          disabled={!currentThread || isLoading}
        >
          <MoreVertical size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Quick Actions */}
      {displayedMessages.length === 0 && !isLoading && (
        <View style={styles.quickActionsContainer}>
          <Text style={[styles.quickActionsTitle, { color: colors.textSecondary }]}>
            Quick Start
          </Text>
          <View style={styles.quickActions}>
            {QUICK_ACTIONS.slice(0, 4).map((action) => (
              <TouchableOpacity
                key={action.id}
                style={[styles.quickActionButton, { backgroundColor: colors.surface }]}
                onPress={() => handleQuickAction(action)}
                disabled={isLoading}
              >
                <Sparkles size={16} color={colors.secondary} />
                <Text style={[styles.quickActionText, { color: colors.text }]}>
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Messages */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: 8 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {error && (
          <View style={[styles.errorBanner, { backgroundColor: colors.errorLight }]}>
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
            <TouchableOpacity onPress={() => setError(null)}>
              <Text style={[styles.dismissText, { color: colors.error }]}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}

        {displayedMessages.length === 0 && !optimisticUserMessage && !streamingAssistantText && !isLoading ? (
          <EmptyState
            title="Start a conversation"
            description="Type a message below to begin writing with AI assistance"
          />
        ) : (
          <>
            {displayedMessages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                colors={colors}
                isUser={message.role === 'user'}
                canEdit={message.role === 'user'}
                canRegenerate={message.role === 'assistant'}
                disabled={isLoading}
                onEdit={handleStartEditMessage}
                onRegenerate={(targetMessage) => { void handleRegenerateMessage(targetMessage); }}
              />
            ))}
            {optimisticUserMessage && (
              <ChatMessage
                key={optimisticUserMessage.id}
                message={optimisticUserMessage}
                colors={colors}
                isUser
              />
            )}
            {streamingAssistantText ? (
              <ChatMessage
                key="streaming-assistant"
                message={createTemporaryMessage(
                  optimisticUserMessage?.projectId || currentProject?.id || '',
                  optimisticUserMessage?.threadId || currentThread?.id || '',
                  'assistant',
                  streamingAssistantText
                )}
                colors={colors}
                isUser={false}
              />
            ) : null}
          </>
        )}

        {isLoading && !streamingAssistantText && (
          <View style={[styles.loadingMessage, { backgroundColor: colors.surface }]}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              AI is typing...
            </Text>
          </View>
        )}

        {lastUsage && !isLoading && (
          <View style={styles.usageContainer}>
            <Text style={[styles.usageText, { color: colors.textTertiary }]}>
              Tokens: {formatTokens(lastUsage.total)} (Prompt: {formatTokens(lastUsage.promptTokens)}, Completion: {formatTokens(lastUsage.completionTokens)})
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Input */}
      {editingMessage ? (
        <View style={[styles.editBanner, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
          <View style={styles.editBannerTextWrap}>
            <Text style={[styles.editBannerTitle, { color: colors.primary }]}>Editing earlier message</Text>
            <Text style={[styles.editBannerText, { color: colors.textSecondary }]}>
              Sending now will replace everything after this message in the current chat.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.editBannerButton, { backgroundColor: colors.surface }]}
            onPress={handleCancelEditing}
            disabled={isLoading}
          >
            <X size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={[styles.inputContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <TextInput
          ref={inputRef}
          style={[styles.input, { color: colors.text, backgroundColor: colors.input, maxHeight: 120 }]}
          placeholder="Type your message..."
          placeholderTextColor={colors.placeholder}
          value={inputText}
          onChangeText={setInputText}
          multiline
          returnKeyType="default"
          blurOnSubmit={false}
          editable={!!currentThread && !isLoading}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            { backgroundColor: inputText.trim() ? colors.primary : colors.border },
          ]}
          onPress={() => handleSendMessage()}
          disabled={!inputText.trim() || isLoading || !currentThread}
        >
          <Send size={20} color={inputText.trim() ? '#FFFFFF' : colors.textTertiary} />
        </TouchableOpacity>
      </View>

      {/* Action buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => {
            setSystemPrompt(currentProject.systemPrompt);
            setSystemPromptModalVisible(true);
          }}
        >
          <Settings size={18} color={colors.textSecondary} />
          <Text style={[styles.actionButtonText, { color: colors.textSecondary }]}>Prompt</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={handleClearHistory}>
          <Trash2 size={18} color={colors.textSecondary} />
          <Text style={[styles.actionButtonText, { color: colors.textSecondary }]}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={handleExport}>
          <Download size={18} color={colors.textSecondary} />
          <Text style={[styles.actionButtonText, { color: colors.textSecondary }]}>Export</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );

  const renderTools = () => (
    <ScrollView style={styles.toolsContainer} contentContainerStyle={styles.toolsContent}>
      {/* Tools Sub-tabs */}
      <View style={styles.toolsTabs}>
        {(['outline', 'scenes', 'quick'] as ToolsSubTab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.toolsTab,
              { backgroundColor: toolsTab === tab ? colors.primaryLight : colors.surfaceSecondary },
            ]}
            onPress={() => setToolsTab(tab)}
          >
            <Text
              style={[
                styles.toolsTabText,
                { color: toolsTab === tab ? colors.primary : colors.textSecondary },
              ]}
            >
              {tab === 'outline' ? 'Outline' : tab === 'scenes' ? 'Scenes' : 'Quick Actions'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {toolsTab === 'outline' && (
        <View style={styles.toolSection}>
          <Text style={[styles.toolTitle, { color: colors.text }]}>Story Outline</Text>
          <Text style={[styles.toolDescription, { color: colors.textSecondary }]}>
            Generate and save a structured outline from your current project context.
          </Text>
          <Button
            title={generatingOutline ? 'Generating Outline...' : 'Generate Outline'}
            onPress={handleGenerateOutline}
            loading={generatingOutline}
            disabled={isLoading}
            style={styles.toolButton}
          />
          {currentProject.storyOutline ? (
            <View style={[styles.outlineDisplay, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.outlineText, { color: colors.text }]}>
                {currentProject.storyOutline}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {toolsTab === 'scenes' && (
        <View style={styles.toolSection}>
          <Text style={[styles.toolTitle, { color: colors.text }]}>Scene Suggestions</Text>
          <Text style={[styles.toolDescription, { color: colors.textSecondary }]}>
            Get AI-suggested next scenes based on your current story position.
          </Text>
          <Button title="Suggest Scenes" onPress={handleSuggestScenes} style={styles.toolButton} />
        </View>
      )}

      {toolsTab === 'quick' && (
        <View style={styles.toolSection}>
          <Text style={[styles.toolTitle, { color: colors.text }]}>Quick Actions</Text>
          <Text style={[styles.toolDescription, { color: colors.textSecondary }]}>
            One-tap prompts for common writing tasks.
          </Text>
          <View style={styles.quickActionGrid}>
            {QUICK_ACTIONS.map((action) => (
              <TouchableOpacity
                key={action.id}
                style={[styles.quickActionCard, { backgroundColor: colors.surface }]}
                onPress={() => handleQuickAction(action)}
              >
                <Sparkles size={16} color={colors.secondary} />
                <Text style={[styles.quickActionCardText, { color: colors.text }]}>
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: currentProject.name,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text },
          headerRight: () => (
            <View style={styles.headerButtons}>
              <Text style={[styles.tokenWarning, { color: colors.textTertiary }]}>
                {formatDate(currentProject.updatedAt)}
              </Text>
            </View>
          ),
        }}
      />

      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Tab Bar */}
        <View style={[styles.tabBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {(['chat', 'tools', 'memory', 'files'] as TabType[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[
                styles.tab,
                currentTab === tab && { backgroundColor: colors.primaryLight },
              ]}
              onPress={() => setCurrentTab(tab)}
            >
              {tab === 'chat' && <Pen size={16} color={currentTab === tab ? colors.primary : colors.textSecondary} />}
              {tab === 'tools' && <Sparkles size={16} color={currentTab === tab ? colors.primary : colors.textSecondary} />}
              {tab === 'memory' && <Brain size={16} color={currentTab === tab ? colors.primary : colors.textSecondary} />}
              {tab === 'files' && <FolderOpen size={16} color={currentTab === tab ? colors.primary : colors.textSecondary} />}
              <Text
                style={[
                  styles.tabText,
                  { color: currentTab === tab ? colors.primary : colors.textSecondary },
                ]}
              >
                {tab === 'files' ? 'Files' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Content */}
        {currentTab === 'chat' && renderChat()}
        {currentTab === 'memory' && (
          <MemoryPanel projectId={currentProject.id} colors={colors} />
        )}
        {currentTab === 'tools' && renderTools()}
        {currentTab === 'files' && (
          <FilesPanel
            files={files}
            onAddFile={handleImportFile}
            onDeleteFile={deleteProjectFile}
            onToggleFile={(id, enabled) => updateFile(id, { enabled })}
            onChangeMode={(id, mode) => updateFile(id, { includeMode: mode })}
            onLoadChunks={loadFileChunks}
            loading={loadingFiles}
          />
        )}

        {/* System Prompt Modal */}
        <Modal
          visible={systemPromptModalVisible}
          onClose={() => setSystemPromptModalVisible(false)}
          title="System Prompt"
        >
          <Text style={[styles.modalDescription, { color: colors.textSecondary }]}>
            Configure how the AI should behave. This prompt is included with every message.
          </Text>
          <TextInput
            style={[
              styles.systemPromptInput,
              { backgroundColor: colors.input, color: colors.text, borderColor: colors.border },
            ]}
            value={systemPrompt}
            onChangeText={setSystemPrompt}
            placeholder="Enter a system prompt..."
            placeholderTextColor={colors.placeholder}
            multiline
            numberOfLines={6}
          />
          <View style={styles.templateButtons}>
            <Text style={[styles.templateLabel, { color: colors.text }]}>Templates:</Text>
            <View style={styles.templateRow}>
              <TouchableOpacity
                style={[styles.templateButton, { backgroundColor: colors.surfaceSecondary }]}
                onPress={() => setSystemPrompt('You are a creative writing assistant specializing in fantasy world-building. Help craft immersive worlds with rich lore, complex characters, and compelling magic systems.')}
              >
                <Text style={[styles.templateButtonText, { color: colors.text }]}>Fantasy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.templateButton, { backgroundColor: colors.surfaceSecondary }]}
                onPress={() => setSystemPrompt('You are a gritty noir fiction editor. Help craft hard-boiled narratives with sharp dialogue, atmospheric descriptions, and morally complex characters. Keep prose punchy and tension high.')}
              >
                <Text style={[styles.templateButtonText, { color: colors.text }]}>Noir</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.templateButton, { backgroundColor: colors.surfaceSecondary }]}
                onPress={() => setSystemPrompt('You are a supportive creative writing coach. Encourage the writer, provide constructive feedback, and help overcome blocks. Focus on their strengths while gently suggesting improvements.')}
              >
                <Text style={[styles.templateButtonText, { color: colors.text }]}>Coach</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Button title="Save" onPress={handleSaveSystemPrompt} style={styles.savePromptButton} />
        </Modal>

        <Modal
          visible={threadPickerVisible}
          onClose={() => setThreadPickerVisible(false)}
          title="Project Chats"
        >
          <Text style={[styles.modalDescription, { color: colors.textSecondary }]}>
            Switch between separate conversations inside this project.
          </Text>
          <View style={styles.threadList}>
            {threads.map((thread) => {
              const isActive = thread.id === currentThread?.id;
              return (
                <TouchableOpacity
                  key={thread.id}
                  style={[
                    styles.threadListItem,
                    {
                      backgroundColor: isActive ? colors.primaryLight : colors.surfaceSecondary,
                      borderColor: isActive ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => handleSelectThread(thread)}
                >
                  <View style={styles.threadListText}>
                    <Text style={[styles.threadListTitle, { color: isActive ? colors.primary : colors.text }]} numberOfLines={1}>
                      {thread.title}
                    </Text>
                    <Text style={[styles.threadListDate, { color: colors.textSecondary }]}>
                      Updated {formatDate(thread.updatedAt)}
                    </Text>
                  </View>
                  {isActive ? (
                    <Text style={[styles.threadActiveBadge, { color: colors.primary }]}>Active</Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
          <Button title="New Chat" onPress={openNewThreadModal} style={styles.threadModalButton} />
        </Modal>

        <Modal
          visible={threadActionsVisible}
          onClose={() => setThreadActionsVisible(false)}
          title="Manage Chat"
        >
          <Text style={[styles.modalDescription, { color: colors.textSecondary }]}>
            {currentThread ? `Adjust settings for "${currentThread.title}".` : 'Choose a chat first.'}
          </Text>
          <Button title="Rename Chat" onPress={openRenameThreadModal} disabled={!currentThread} style={styles.threadModalButton} />
          <Button
            title="Delete Chat"
            onPress={handleDeleteCurrentThread}
            variant="danger"
            disabled={!currentThread}
            style={styles.threadModalButton}
          />
        </Modal>

        <Modal
          visible={threadEditorVisible}
          onClose={() => {
            setThreadEditorVisible(false);
            setEditingThreadId(null);
            setThreadTitleDraft('');
          }}
          title={editingThreadId ? 'Rename Chat' : 'New Chat'}
        >
          <Text style={[styles.modalLabel, { color: colors.text }]}>Chat Title</Text>
          <Input
            value={threadTitleDraft}
            onChangeText={setThreadTitleDraft}
            placeholder="e.g., Chapter 7 ideas"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSaveThread}
            containerStyle={styles.modalInput}
          />
          <Button
            title={editingThreadId ? 'Save Changes' : 'Create Chat'}
            onPress={handleSaveThread}
            disabled={!threadTitleDraft.trim()}
          />
        </Modal>
      </View>
    </>
  );
}

// Memory Panel Component
function MemoryPanel({ projectId, colors }: { projectId: string; colors: any }) {
  const { memories, loadMemories, createMemory, updateMemory, deleteMemory } = useApp();
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  useFocusEffect(
    useCallback(() => {
      loadMemories(projectId);
    }, [projectId, loadMemories])
  );

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;

    if (editingId) {
      await updateMemory(editingId, { title: title.trim(), content: content.trim() });
    } else {
      await createMemory(projectId, title.trim(), content.trim());
    }

    setModalVisible(false);
    setEditingId(null);
    setTitle('');
    setContent('');
  };

  const handleEdit = (memory: typeof memories[0]) => {
    setEditingId(memory.id);
    setTitle(memory.title);
    setContent(memory.content);
    setModalVisible(true);
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await updateMemory(id, { enabled: !enabled });
  };

  const handleDelete = (memory: typeof memories[0]) => {
    Alert.alert(
      'Delete Memory',
      `Are you sure you want to delete "${memory.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteMemory(memory.id),
        },
      ]
    );
  };

  return (
    <View style={styles.memoryContainer}>
      <View style={styles.memoryHeader}>
        <Text style={[styles.memoryTitle, { color: colors.text }]}>Project Memory</Text>
        <Button
          title="Add Note"
          size="small"
          onPress={() => setModalVisible(true)}
        />
      </View>

      <Text style={[styles.memoryHint, { color: colors.textSecondary }]}>
        Notes are automatically included with every AI message to provide context.
      </Text>

      {memories.length === 0 ? (
        <EmptyState
          title="No memory notes"
          description="Add notes about characters, plot points, or world-building details"
        />
      ) : (
        <ScrollView style={styles.memoryList} contentContainerStyle={styles.memoryListContent}>
          {memories.map((memory) => (
            <TouchableOpacity
              key={memory.id}
              style={[
                styles.memoryCard,
                { backgroundColor: colors.card, borderColor: colors.border, opacity: memory.enabled ? 1 : 0.5 },
              ]}
              onPress={() => handleEdit(memory)}
              onLongPress={() => handleDelete(memory)}
            >
              <View style={styles.memoryCardHeader}>
                <Text style={[styles.memoryCardTitle, { color: colors.text }]}>
                  {memory.title}
                </Text>
                <TouchableOpacity
                  style={[
                    styles.toggleButton,
                    { backgroundColor: memory.enabled ? colors.successLight : colors.surfaceSecondary },
                  ]}
                  onPress={() => handleToggle(memory.id, memory.enabled)}
                >
                  <Text style={[styles.toggleText, { color: memory.enabled ? colors.success : colors.textSecondary }]}>
                    {memory.enabled ? 'ON' : 'OFF'}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.memoryCardContent, { color: colors.textSecondary }]} numberOfLines={3}>
                {memory.content}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <Modal
        visible={modalVisible}
        onClose={() => {
          setModalVisible(false);
          setEditingId(null);
          setTitle('');
          setContent('');
        }}
        title={editingId ? 'Edit Memory' : 'New Memory Note'}
      >
        <Text style={[styles.modalLabel, { color: colors.text }]}>Title</Text>
        <TextInput
          style={[
            styles.modalInput,
            { backgroundColor: colors.input, color: colors.text, borderColor: colors.border },
          ]}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g., Main Character, World Rules"
          placeholderTextColor={colors.placeholder}
        />
        <Text style={[styles.modalLabel, { color: colors.text }]}>Content</Text>
        <TextInput
          style={[
            styles.modalTextarea,
            { backgroundColor: colors.input, color: colors.text, borderColor: colors.border },
          ]}
          value={content}
          onChangeText={setContent}
          placeholder="Write your notes here..."
          placeholderTextColor={colors.placeholder}
          multiline
          numberOfLines={4}
        />
        <Button
          title={editingId ? 'Update' : 'Save'}
          onPress={handleSave}
          disabled={!title.trim() || !content.trim()}
          style={styles.modalSaveButton}
        />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tokenWarning: {
    fontSize: 12,
  },
  tabBar: {
    flexDirection: 'row',
    padding: 8,
    borderBottomWidth: 1,
    gap: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Chat styles
  chatContainer: {
    flex: 1,
  },
  threadBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  threadSelector: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  threadSelectorText: {
    flex: 1,
    marginRight: 12,
  },
  threadLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  threadTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  threadQuickButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  threadQuickButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  threadIconButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  threadList: {
    gap: 10,
    marginBottom: 16,
  },
  threadListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  threadListText: {
    flex: 1,
  },
  threadListTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  threadListDate: {
    fontSize: 13,
  },
  threadActiveBadge: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  threadModalButton: {
    marginTop: 8,
  },
  quickActionsContainer: {
    padding: 16,
    paddingTop: 8,
  },
  quickActionsTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  quickActionText: {
    fontSize: 13,
    fontWeight: '500',
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
    paddingBottom: 8,
  },
  messageContainer: {
    marginBottom: 12,
  },
  userMessageContainer: {
    alignItems: 'flex-end',
  },
  assistantMessageContainer: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '85%',
    padding: 12,
    borderRadius: 16,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  tokenCount: {
    fontSize: 11,
    marginTop: 4,
  },
  messageActionRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  messageActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  messageActionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  loadingMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 16,
    alignSelf: 'flex-start',
  },
  loadingText: {
    fontSize: 14,
  },
  usageContainer: {
    alignItems: 'center',
    padding: 8,
  },
  usageText: {
    fontSize: 11,
  },
  errorBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
  },
  dismissText: {
    fontSize: 14,
    fontWeight: '600',
  },
  editBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 14,
  },
  editBannerTextWrap: {
    flex: 1,
  },
  editBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  editBannerText: {
    fontSize: 12,
    lineHeight: 18,
  },
  editBannerButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    borderTopWidth: 1,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    padding: 12,
    borderRadius: 20,
    minHeight: 44,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    paddingVertical: 8,
    paddingBottom: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionButtonText: {
    fontSize: 13,
  },

  // Tools styles
  toolsContainer: {
    flex: 1,
  },
  toolsContent: {
    padding: 16,
  },
  toolsTabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  toolsTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  toolsTabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  toolSection: {
    marginBottom: 24,
  },
  toolTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  toolDescription: {
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },
  toolButton: {
    marginBottom: 16,
  },
  outlineDisplay: {
    padding: 16,
    borderRadius: 12,
  },
  outlineText: {
    fontSize: 14,
    lineHeight: 22,
  },
  quickActionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  quickActionCard: {
    width: (SCREEN_WIDTH - 56) / 2,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    gap: 8,
  },
  quickActionCardText: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },

  // Memory styles
  memoryContainer: {
    flex: 1,
    padding: 16,
  },
  memoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  memoryTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  memoryHint: {
    fontSize: 13,
    marginBottom: 16,
  },
  memoryList: {
    flex: 1,
  },
  memoryListContent: {
    paddingBottom: 20,
  },
  memoryCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  memoryCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  memoryCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  toggleButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  toggleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  memoryCardContent: {
    fontSize: 14,
    lineHeight: 20,
  },

  // Modal styles
  modalDescription: {
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },
  systemPromptInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    minHeight: 150,
    textAlignVertical: 'top',
  },
  templateButtons: {
    marginTop: 16,
  },
  templateLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  templateRow: {
    flexDirection: 'row',
    gap: 8,
  },
  templateButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  templateButtonText: {
    fontSize: 13,
    fontWeight: '500',
  },
  savePromptButton: {
    marginTop: 20,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  modalTextarea: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    minHeight: 120,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  modalSaveButton: {
    marginTop: 8,
  },
});
