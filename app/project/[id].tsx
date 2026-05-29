import { useState, useRef, useCallback, useMemo } from 'react';
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
  Sparkles,
  FolderOpen,
  Plus,
  X,
  RotateCcw,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useApp } from '@/contexts/AppContext';
import { Button, EmptyState, LoadingIndicator, Modal, FilesPanel } from '@/components';
import { sendMessage, ApiError } from '@/services/api';
import { formatTokens, formatDate } from '@/utils/helpers';
import { Message, QUICK_ACTIONS } from '@/types';
import * as storage from '@/services/storage';
import { FileSizeLimitError, UnsupportedFileTypeError } from '@/utils/fileImport';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type TabType = 'chat' | 'memory' | 'tools' | 'files';
type ToolsSubTab = 'outline' | 'scenes' | 'quick';

interface ChatMessageProps {
  message: Message;
  colors: any;
  isUser: boolean;
  isLastAssistant?: boolean;
  onRegenerate?: () => void;
  isLoading?: boolean;
  isStreaming?: boolean;
}

function ChatMessage({ message, colors, isUser, isLastAssistant, onRegenerate, isLoading, isStreaming }: ChatMessageProps) {
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
        fontFamily: 'Cormorant_400Regular',
        fontSize: 16.5,
        lineHeight: 28,
        color: colors.proseAiText,
      }}>
        {message.content || (isStreaming ? 'Thinking...' : '')}
      </Text>
      {isStreaming && !message.content && (
        <View style={styles.streamingIndicator}>
          <ActivityIndicator color={colors.primary} size="small" />
          <Text style={[styles.streamingIndicatorText, { color: colors.textSecondary }]}>
            Generating response...
          </Text>
        </View>
      )}
      {isLastAssistant && onRegenerate && (
        <TouchableOpacity
          onPress={onRegenerate}
          disabled={isLoading}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            marginTop: 12,
            alignSelf: 'flex-start',
            opacity: isLoading ? 0.4 : 0.6,
          }}
        >
          <RotateCcw size={12} color={colors.textTertiary} />
          <Text style={{ fontSize: 11, color: colors.textTertiary }}>Regenerate</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const {
    loadProjects, selectProject, currentProject,
    threads, currentThread, createThread, selectThread, deleteThread,
    messages, loadMessages, clearMessages,
    files, loadingFiles, createProjectFileFromImport, updateFile, deleteFile, loadFileChunks,
    settings, updateProject,
  } = useApp();

  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveMessages, setLiveMessages] = useState<Message[]>([]);
  const [currentTab, setCurrentTab] = useState<TabType>('chat');
  const [toolsTab, setToolsTab] = useState<ToolsSubTab>('outline');
  const [lastUsage, setLastUsage] = useState<{ promptTokens: number; completionTokens: number; total: number } | null>(null);
  const [systemPromptModalVisible, setSystemPromptModalVisible] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');

  const inputRef = useRef<TextInput>(null);
  const safeThreads = useMemo(() => (Array.isArray(threads) ? threads : []), [threads]);
  const safeMessages = useMemo(() => (Array.isArray(messages) ? messages : []), [messages]);
  const displayedMessages = [...safeMessages, ...liveMessages];
  const hasLiveAssistantMessage = liveMessages.some((message) => message.role === 'assistant');

  const createLiveMessage = useCallback((role: 'user' | 'assistant', content = ''): Message => ({
    id: `live-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId: currentProject?.id || '',
    threadId: currentThread?.id || '',
    role,
    content,
    createdAt: new Date().toISOString(),
  }), [currentProject?.id, currentThread?.id]);

  // Find and select project
  useFocusEffect(
    useCallback(() => {
      if (id && typeof id === 'string') {
        loadProjects().then((loadedProjects) => {
          const project = loadedProjects.find((p) => p.id === id);
          if (project) {
            selectProject(project);
            setSystemPrompt(project.systemPrompt || '');
          }
        });
      }
    }, [id, loadProjects, selectProject])
  );

  const handleSendMessage = useCallback(async (contextPrompt?: string) => {
    const messageText = contextPrompt || inputText.trim();
    if (!messageText || !currentProject || !currentThread || isLoading) return;

    if (!settings.openRouterApiKey) {
      Alert.alert('API Key Required', 'Please configure your OpenRouter API key in Settings.');
      return;
    }

    setInputText('');
    setIsLoading(true);
    setError(null);

    const liveUserMessage = createLiveMessage('user', messageText);
    const liveAssistantMessage = createLiveMessage('assistant');
    setLiveMessages([liveUserMessage, liveAssistantMessage]);

    try {
      const conversationHistory = safeMessages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      await storage.addMessage({
        projectId: currentProject.id,
        threadId: currentThread.id,
        role: 'user',
        content: messageText,
      });

      const response = await sendMessage(
        currentProject.id,
        currentThread.id,
        messageText,
        systemPrompt,
        conversationHistory,
        undefined,
        {
          skipUserMessage: true,
          onChunk: (partial) => setLiveMessages([
            liveUserMessage,
            { ...liveAssistantMessage, content: partial },
          ]),
        }
      );

      setLastUsage({
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        total: response.usage.totalTokens,
      });

      await loadMessages(currentProject.id, currentThread.id);
      setLiveMessages([]);
      await loadProjects();
    } catch (err) {
      await loadMessages(currentProject.id, currentThread.id);
      setLiveMessages([]);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [
    createLiveMessage,
    currentProject,
    currentThread,
    inputText,
    isLoading,
    loadMessages,
    loadProjects,
    safeMessages,
    settings.openRouterApiKey,
    systemPrompt,
  ]);

  const handleRegenerate = useCallback(async () => {
    if (!currentProject || !currentThread || isLoading) return;

    const lastAssistantIndex = safeMessages.map(m => m.role).lastIndexOf('assistant');
    if (lastAssistantIndex === -1) return;
    const lastAssistantMsg = safeMessages[lastAssistantIndex];

    const messagesBeforeAssistant = safeMessages.slice(0, lastAssistantIndex);
    const lastUserMsgIndex = messagesBeforeAssistant.map(m => m.role).lastIndexOf('user');
    if (lastUserMsgIndex === -1) return;
    const lastUserMsg = messagesBeforeAssistant[lastUserMsgIndex];

    const historyMessages = messagesBeforeAssistant
      .slice(0, lastUserMsgIndex)
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    setIsLoading(true);
    setError(null);

    await storage.deleteMessage(lastAssistantMsg.id);
    await loadMessages(currentProject.id, currentThread.id);

    const liveAssistantMessage = createLiveMessage('assistant');
    setLiveMessages([liveAssistantMessage]);

    try {
      const response = await sendMessage(
        currentProject.id,
        currentThread.id,
        lastUserMsg.content,
        systemPrompt,
        historyMessages,
        undefined,
        {
          skipUserMessage: true,
          onChunk: (partial) => setLiveMessages([{ ...liveAssistantMessage, content: partial }]),
        }
      );

      setLastUsage({
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        total: response.usage.totalTokens,
      });

      await loadMessages(currentProject.id, currentThread.id);
      setLiveMessages([]);
      await loadProjects();
    } catch (err) {
      await storage.addMessage({
        projectId: currentProject.id,
        threadId: currentThread.id,
        role: 'assistant',
        content: lastAssistantMsg.content,
        tokens: lastAssistantMsg.tokens,
      });
      await loadMessages(currentProject.id, currentThread.id);
      setLiveMessages([]);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [
    createLiveMessage,
    currentProject,
    currentThread,
    isLoading,
    loadMessages,
    loadProjects,
    safeMessages,
    systemPrompt,
  ]);

  const handleQuickAction = useCallback((action: typeof QUICK_ACTIONS[0]) => {
    void handleSendMessage(action.prompt);
  }, [handleSendMessage]);

  const handleClearHistory = () => {
    Alert.alert(
      'Clear Conversation',
      'Are you sure you want to clear all messages in this chat? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            if (currentProject && currentThread) {
              await clearMessages(currentThread.id);
              await loadMessages(currentProject.id, currentThread.id);
            }
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
    const outlinePrompt = `Generate a structured story outline for the following. Include Act 1, Act 2 (Parts A and B), and Act 3. For each section, provide:
- Key story beats
- Character development moments
- Major plot points
- Estimated length/page count

${currentProject?.storyOutline ? `Current story idea: ${currentProject.storyOutline}` : 'Please first describe your story concept.'}`;
    setInputText(outlinePrompt);
  };

  const handleSuggestScenes = async () => {
    const scenePrompt = `Based on the story so far, suggest 3-5 possible next scenes. For each scene:
- Give a brief description
- Note the emotional tone
- Explain how it advances the plot
Consider pacing, tension building, and character development.`;
    setInputText(scenePrompt);
  };

  const handleCreateThread = async () => {
    if (!currentProject) return;
    const count = safeThreads.length + 1;
    await createThread(currentProject.id, `Chat ${count}`);
    setLastUsage(null);
  };

  const handleDeleteThread = (threadId: string) => {
    if (safeThreads.length <= 1) return;
    Alert.alert(
      'Delete Chat',
      'Are you sure you want to delete this chat and all its messages?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteThread(threadId),
        },
      ]
    );
  };

  if (!currentProject) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <LoadingIndicator fullScreen />
      </View>
    );
  }

  const renderChat = () => (
    <KeyboardAvoidingView
      style={styles.chatContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Thread Switcher */}
      <View style={[styles.threadSwitcher, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.threadSwitcherScroll}>
          {safeThreads.map((thread) => {
            const isActive = currentThread?.id === thread.id;
            return (
              <View key={thread.id} style={styles.threadChipWrapper}>
                <TouchableOpacity
                  style={[
                    styles.threadChip,
                    {
                      backgroundColor: isActive ? colors.primaryLight : colors.surfaceSecondary,
                      borderColor: isActive ? colors.primary : colors.border,
                      opacity: isLoading ? 0.6 : 1,
                    },
                  ]}
                  onPress={() => { selectThread(thread); setLastUsage(null); }}
                  disabled={isLoading}
                >
                  <Text style={[styles.threadChipText, { color: isActive ? colors.primary : colors.textSecondary }]} numberOfLines={1}>
                    {thread.title || 'Chat'}
                  </Text>
                  {safeThreads.length > 1 && (
                    <TouchableOpacity
                      onPress={() => handleDeleteThread(thread.id)}
                      disabled={isLoading}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <X size={12} color={isActive ? colors.primary : colors.textTertiary} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
          <TouchableOpacity
            style={[styles.threadAddButton, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, opacity: isLoading ? 0.6 : 1 }]}
            onPress={handleCreateThread}
            disabled={isLoading}
          >
            <Plus size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </ScrollView>
      </View>
      {/* Quick Actions */}
      {safeMessages.length === 0 && liveMessages.length === 0 && !isLoading && (
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

        {displayedMessages.length === 0 ? (
          <EmptyState
            title="Start a conversation"
            description="Type a message below to begin writing with AI assistance"
          />
        ) : (
          <>
            {displayedMessages.map((message, index) => {
              const isLiveMessage = liveMessages.some((liveMessage) => liveMessage.id === message.id);
              const isLastAssistant =
                message.role === 'assistant' &&
                !displayedMessages.slice(index + 1).some(m => m.role === 'assistant') &&
                !hasLiveAssistantMessage &&
                !isLoading;
              return (
                <ChatMessage
                  key={message.id}
                  message={message}
                  colors={colors}
                  isUser={message.role === 'user'}
                  isLastAssistant={isLastAssistant}
                  onRegenerate={isLastAssistant ? handleRegenerate : undefined}
                  isLoading={isLoading}
                  isStreaming={isLiveMessage && message.role === 'assistant'}
                />
              );
            })}
          </>
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
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            { backgroundColor: inputText.trim() ? colors.primary : colors.border },
          ]}
          onPress={() => handleSendMessage()}
          disabled={!inputText.trim() || isLoading}
        >
          <Send size={20} color={inputText.trim() ? '#FFFFFF' : colors.textTertiary} />
        </TouchableOpacity>
      </View>

      {/* Action buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity style={[styles.actionButton, isLoading && styles.actionButtonDisabled]} onPress={() => setSystemPromptModalVisible(true)} disabled={isLoading}>
          <Settings size={18} color={colors.textSecondary} />
          <Text style={[styles.actionButtonText, { color: colors.textSecondary }]}>Prompt</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, isLoading && styles.actionButtonDisabled]} onPress={handleClearHistory} disabled={isLoading}>
          <Trash2 size={18} color={colors.textSecondary} />
          <Text style={[styles.actionButtonText, { color: colors.textSecondary }]}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, isLoading && styles.actionButtonDisabled]} onPress={handleExport} disabled={isLoading}>
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
            Generate a structured 3-act or chapter-by-chapter outline for your story.
          </Text>
          <Button title="Generate Outline" onPress={handleGenerateOutline} style={styles.toolButton} />
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
            onDeleteFile={deleteFile}
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
      </View>
    </>
  );
}

// Memory Panel Component
function MemoryPanel({ projectId, colors }: { projectId: string; colors: any }) {
  const { memories, loadMemories, createMemory, updateMemory, deleteMemory } = useApp();
  const safeMemories = Array.isArray(memories) ? memories : [];
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

  const handleEdit = (memory: typeof safeMemories[number]) => {
    setEditingId(memory.id);
    setTitle(memory.title);
    setContent(memory.content);
    setModalVisible(true);
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await updateMemory(id, { enabled: !enabled });
  };

  const handleDelete = (memory: typeof safeMemories[number]) => {
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

      {safeMemories.length === 0 ? (
        <EmptyState
          title="No memory notes"
          description="Add notes about characters, plot points, or world-building details"
        />
      ) : (
        <ScrollView style={styles.memoryList} contentContainerStyle={styles.memoryListContent}>
          {safeMemories.map((memory) => (
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

  // Thread switcher
  threadSwitcher: {
    borderBottomWidth: 1,
    paddingVertical: 8,
  },
  threadSwitcherScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  threadChipWrapper: {
    flexShrink: 0,
  },
  threadChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 140,
  },
  threadChipText: {
    fontSize: 13,
    fontWeight: '500',
    flexShrink: 1,
  },
  threadAddButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Chat styles
  chatContainer: {
    flex: 1,
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
  streamingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  streamingIndicatorText: {
    fontSize: 13,
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
  actionButtonDisabled: {
    opacity: 0.5,
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
