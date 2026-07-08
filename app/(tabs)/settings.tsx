import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Share,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File } from 'expo-file-system';
import { Monitor, Moon, Sun, Check, Eye, EyeOff, ExternalLink, Download, Upload } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useApp } from '@/contexts/AppContext';
import { Button, Input, Card, CardHeader, LoadingIndicator, Modal } from '@/components';
import { AVAILABLE_MODELS } from '@/types';
import { createAppBackup, getStorageDiagnostics, inspectAppBackup, restoreAppBackup, type AppBackupSummary } from '@/services/storage';

export default function SettingsScreen() {
  const { colors, mode, setThemeMode } = useTheme();
  const { settings, loadingSettings, loadSettings, updateSettings, loadProjects, selectProject } = useApp();

  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedModel, setSelectedModel] = useState(settings.selectedModel);
  const [diagnosticModalVisible, setDiagnosticModalVisible] = useState(false);
  const [runningDiagnostic, setRunningDiagnostic] = useState(false);
  const [diagnosticSummary, setDiagnosticSummary] = useState('');
  const [diagnosticExportText, setDiagnosticExportText] = useState('');
  const [exportingBackup, setExportingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [backupStatus, setBackupStatus] = useState('');

  useFocusEffect(
    useCallback(() => {
      void loadSettings();
    }, [loadSettings])
  );

  useEffect(() => {
    const syncTimer = setTimeout(() => {
      setApiKey(settings.openRouterApiKey);
      setSelectedModel(settings.selectedModel);
    }, 0);

    return () => clearTimeout(syncTimer);
  }, [settings]);

  const handleSaveApiKey = async () => {
    setSaving(true);
    try {
      await updateSettings({ openRouterApiKey: apiKey });
      Alert.alert('Success', 'API key saved successfully');
    } catch {
      Alert.alert('Error', 'Failed to save API key');
    } finally {
      setSaving(false);
    }
  };

  const handleSelectModel = async (modelId: string) => {
    setSelectedModel(modelId);
    await updateSettings({ selectedModel: modelId });
  };

  const handleThemeChange = (newMode: 'light' | 'dark' | 'system') => {
    setThemeMode(newMode);
  };

  const formatBackupSummary = (summary: AppBackupSummary) => {
    const parts = [
      `${summary.projectCount} project${summary.projectCount === 1 ? '' : 's'}`,
      `${summary.threadCount} chat${summary.threadCount === 1 ? '' : 's'}`,
      `${summary.messageCount} message${summary.messageCount === 1 ? '' : 's'}`,
    ];

    if (summary.memoryCount > 0) {
      parts.push(`${summary.memoryCount} memory note${summary.memoryCount === 1 ? '' : 's'}`);
    }

    if (summary.fileCount > 0) {
      parts.push(`${summary.fileCount} file${summary.fileCount === 1 ? '' : 's'}`);
    }

    return parts.join(', ');
  };

  const buildBackupDetails = (summary: AppBackupSummary) => [
    `Projects: ${summary.projectCount}`,
    `Chats: ${summary.threadCount}`,
    `Messages: ${summary.messageCount}`,
    `Memory notes: ${summary.memoryCount}`,
    `Files: ${summary.fileCount}`,
    `File chunks: ${summary.fileChunkCount}`,
    `Usage entries: ${summary.apiUsageCount}`,
    `Includes saved API key: ${summary.includesApiKey ? 'Yes' : 'No'}`,
    `Created: ${new Date(summary.generatedAt).toLocaleString()}`,
  ].join('\n');

  const isLikelyUserCancellation = (error: unknown) => {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return message.includes('cancel') || message.includes('dismiss');
  };

  const downloadBackupOnWeb = (fileName: string, text: string) => {
    if (typeof document === 'undefined') {
      throw new Error('File download is not available in this environment.');
    }

    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportBackup = async () => {
    setExportingBackup(true);
    try {
      const backup = await createAppBackup();

      if (Platform.OS === 'web') {
        downloadBackupOnWeb(backup.fileName, backup.json);
      } else {
        try {
          const directory = await Directory.pickDirectoryAsync();
          const file = directory.createFile(backup.fileName, 'application/json');
          file.write(backup.json);
        } catch (error) {
          if (isLikelyUserCancellation(error)) {
            return;
          }
          throw error;
        }
      }

      const summaryText = formatBackupSummary(backup.summary);
      setBackupStatus(`Last backup exported: ${summaryText}`);
      Alert.alert(
        'Backup Saved',
        `Saved a full app backup.\n\n${buildBackupDetails(backup.summary)}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Backup Failed', `Could not export your backup.\n\n${message}`);
    } finally {
      setExportingBackup(false);
    }
  };

  const applyBackupRestore = async (json: string) => {
    setRestoringBackup(true);
    try {
      const { summary } = await restoreAppBackup(json);
      await selectProject(null);
      await Promise.all([loadProjects(), loadSettings()]);
      setBackupStatus(`Last restore completed: ${formatBackupSummary(summary)}`);
      Alert.alert(
        'Restore Complete',
        `Local app data was replaced with this backup.\n\n${buildBackupDetails(summary)}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Restore Failed', `Could not restore this backup.\n\n${message}`);
    } finally {
      setRestoringBackup(false);
    }
  };

  const handleRestoreBackup = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', '*/*'],
        multiple: false,
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      if (!asset) {
        return;
      }

      const file = new File(asset.uri);
      const json = await file.text();
      const { summary } = inspectAppBackup(json);

      Alert.alert(
        'Restore Backup',
        `This will replace all local app data on this device.\n\nBackup contents:\n${buildBackupDetails(summary)}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Restore',
            style: 'destructive',
            onPress: () => {
              void applyBackupRestore(json);
            },
          },
        ]
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Backup Read Failed', `Could not open this backup file.\n\n${message}`);
    }
  };

  const handleRunDiagnostic = async () => {
    setRunningDiagnostic(true);
    try {
      const diagnostic = await getStorageDiagnostics();
      setDiagnosticSummary(diagnostic.summaryText);
      setDiagnosticExportText(diagnostic.exportText);
      setDiagnosticModalVisible(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Diagnostic Failed', `Could not generate the storage report.\n\n${message}`);
    } finally {
      setRunningDiagnostic(false);
    }
  };

  const handleExportDiagnostic = async () => {
    if (!diagnosticExportText) return;

    try {
      if (Platform.OS === 'web') {
        await navigator.clipboard?.writeText(diagnosticExportText);
        Alert.alert('Copied', 'The diagnostic report was copied to your clipboard.');
        return;
      }

      await Share.share({
        message: diagnosticExportText,
        title: 'Creative Writing Assistant Storage Diagnostic',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Export Failed', `Could not export the diagnostic report.\n\n${message}`);
    }
  };

  if (loadingSettings) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <LoadingIndicator fullScreen />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Settings</Text>
      </View>

      {/* API Configuration */}
      <Card style={styles.card}>
        <CardHeader
          title="OpenRouter API"
          subtitle="Configure your API key to enable AI chat"
          rightElement={
            <TouchableOpacity
              onPress={() => {
                // Open OpenRouter website (web)
                if (typeof window !== 'undefined') {
                  window.open('https://openrouter.ai', '_blank');
                }
              }}
            >
              <ExternalLink size={20} color={colors.primary} />
            </TouchableOpacity>
          }
        />
        <View style={styles.sectionContent}>
          <Input
            label="API Key"
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="sk-or-..."
            secureTextEntry={!showApiKey}
            autoCapitalize="none"
            autoCorrect={false}
            rightIcon={
              <TouchableOpacity onPress={() => setShowApiKey(!showApiKey)}>
                {showApiKey ? (
                  <EyeOff size={20} color={colors.textSecondary} />
                ) : (
                  <Eye size={20} color={colors.textSecondary} />
                )}
              </TouchableOpacity>
            }
          />
          <Button
            title={saving ? 'Saving...' : 'Save API Key'}
            onPress={handleSaveApiKey}
            loading={saving}
            disabled={!apiKey.trim() || apiKey === settings.openRouterApiKey}
            style={styles.saveButton}
          />
        </View>
      </Card>

      {/* Model Selection */}
      <Card style={styles.card}>
        <CardHeader
          title="AI Model"
          subtitle="Choose the model for your conversations"
        />
        <View style={styles.modelList}>
          {AVAILABLE_MODELS.map((model) => (
            <TouchableOpacity
              key={model.id}
              style={[
                styles.modelItem,
                {
                  backgroundColor:
                    selectedModel === model.id
                      ? colors.primaryLight
                      : colors.surfaceSecondary,
                  borderColor:
                    selectedModel === model.id
                      ? colors.primary
                      : 'transparent',
                },
              ]}
              onPress={() => handleSelectModel(model.id)}
              activeOpacity={0.7}
            >
              <View style={styles.modelInfo}>
                <View style={styles.modelHeader}>
                  <Text
                    style={[
                      styles.modelName,
                      { color: selectedModel === model.id ? colors.primary : colors.text },
                    ]}
                  >
                    {model.name}
                  </Text>
                  <Text
                    style={[
                      styles.modelProvider,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {model.provider}
                  </Text>
                </View>
                <View style={styles.modelDetails}>
                  {model.contextLength && (
                    <Text style={[styles.modelMeta, { color: colors.textTertiary }]}>
                      {model.contextLength} context
                    </Text>
                  )}
                  {model.inputCost && model.outputCost && (
                    <Text style={[styles.modelMeta, { color: colors.textTertiary }]}>
                      {model.inputCost === 'Free' ? 'Free' : `${model.inputCost}/${model.outputCost} per 1M`}
                    </Text>
                  )}
                </View>
              </View>
              {selectedModel === model.id && (
                <Check size={20} color={colors.primary} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </Card>

      {/* Theme Selection */}
      <Card style={styles.card}>
        <CardHeader title="Appearance" subtitle="Choose your preferred theme" />
        <View style={styles.themeOptions}>
          <TouchableOpacity
            style={[
              styles.themeOption,
              {
                backgroundColor:
                  mode === 'light' ? colors.primaryLight : colors.surfaceSecondary,
                borderColor: mode === 'light' ? colors.primary : 'transparent',
              },
            ]}
            onPress={() => handleThemeChange('light')}
          >
            <Sun
              size={24}
              color={mode === 'light' ? colors.primary : colors.textSecondary}
            />
            <Text
              style={[
                styles.themeLabel,
                { color: mode === 'light' ? colors.primary : colors.text },
              ]}
            >
              Light
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.themeOption,
              {
                backgroundColor:
                  mode === 'dark' ? colors.primaryLight : colors.surfaceSecondary,
                borderColor: mode === 'dark' ? colors.primary : 'transparent',
              },
            ]}
            onPress={() => handleThemeChange('dark')}
          >
            <Moon
              size={24}
              color={mode === 'dark' ? colors.primary : colors.textSecondary}
            />
            <Text
              style={[
                styles.themeLabel,
                { color: mode === 'dark' ? colors.primary : colors.text },
              ]}
            >
              Dark
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.themeOption,
              {
                backgroundColor:
                  mode === 'system' ? colors.primaryLight : colors.surfaceSecondary,
                borderColor: mode === 'system' ? colors.primary : 'transparent',
              },
            ]}
            onPress={() => handleThemeChange('system')}
          >
            <Monitor
              size={24}
              color={mode === 'system' ? colors.primary : colors.textSecondary}
            />
            <Text
              style={[
                styles.themeLabel,
                { color: mode === 'system' ? colors.primary : colors.text },
              ]}
            >
              System
            </Text>
          </TouchableOpacity>
        </View>
      </Card>

      <Card style={styles.card}>
        <CardHeader
          title="Backup & Restore"
          subtitle="Export a full local snapshot or replace this device with an existing backup"
        />
        <View style={styles.sectionContent}>
          <Text style={[styles.diagnosticDescription, { color: colors.textSecondary }]}>
            Backups include projects, chats, messages, memory notes, imported files, processed file chunks,
            app settings, and token usage history.
          </Text>
          <Button
            title={exportingBackup ? 'Exporting Backup...' : 'Export Backup'}
            onPress={handleExportBackup}
            loading={exportingBackup}
            disabled={exportingBackup || restoringBackup}
            icon={<Download size={18} color="#FFFFFF" />}
            style={styles.saveButton}
          />
          <Button
            title={restoringBackup ? 'Restoring Backup...' : 'Restore Backup'}
            onPress={handleRestoreBackup}
            loading={restoringBackup}
            disabled={exportingBackup || restoringBackup}
            variant="secondary"
            icon={<Upload size={18} color={colors.text} />}
            style={styles.secondaryButton}
          />
          <Text style={[styles.backupWarning, { color: colors.warning }]}>
            Restoring replaces all current local app data on this device.
          </Text>
          {backupStatus ? (
            <Text style={[styles.backupStatus, { color: colors.textSecondary }]}>
              {backupStatus}
            </Text>
          ) : null}
        </View>
      </Card>

      <Card style={styles.card}>
        <CardHeader
          title="Storage Diagnostic"
          subtitle="Inspect on-device chat storage and export a report"
        />
        <View style={styles.sectionContent}>
          <Text style={[styles.diagnosticDescription, { color: colors.textSecondary }]}>
            This checks whether your phone can still see the legacy message blob, migrated per-thread shards,
            and any mismatches between thread records and stored chat payloads.
          </Text>
          <Button
            title={runningDiagnostic ? 'Running Diagnostic...' : 'Run Diagnostic'}
            onPress={handleRunDiagnostic}
            loading={runningDiagnostic}
            style={styles.saveButton}
          />
          {diagnosticSummary ? (
            <Button
              title="View Latest Report"
              onPress={() => setDiagnosticModalVisible(true)}
              variant="secondary"
              style={styles.secondaryButton}
            />
          ) : null}
        </View>
      </Card>

      {/* About */}
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.textTertiary }]}>
          Creative Writing Assistant v1.0.0
        </Text>
        <Text style={[styles.footerText, { color: colors.textTertiary }]}>
          Powered by OpenRouter API
        </Text>
      </View>

      </ScrollView>

      <Modal
        visible={diagnosticModalVisible}
        onClose={() => setDiagnosticModalVisible(false)}
        title="Storage Diagnostic"
      >
        <Text style={[styles.modalDescription, { color: colors.textSecondary }]}>
          This is the exact report generated on the current device. If the old chats are unreadable here, this should
          make that visible.
        </Text>
        <View style={[styles.diagnosticPreview, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Text style={[styles.diagnosticPreviewText, { color: colors.text }]}>
            {diagnosticSummary || 'No diagnostic report has been generated yet.'}
          </Text>
        </View>
        <View style={styles.diagnosticActions}>
          <Button
            title="Close"
            onPress={() => setDiagnosticModalVisible(false)}
            variant="secondary"
            style={styles.diagnosticActionButton}
          />
          <Button
            title="Export Report"
            onPress={handleExportDiagnostic}
            disabled={!diagnosticExportText}
            style={styles.diagnosticActionButton}
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
  },
  card: {
    marginBottom: 16,
  },
  sectionContent: {
    marginTop: 8,
  },
  secondaryButton: {
    marginTop: 10,
  },
  backupWarning: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
  backupStatus: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  saveButton: {
    marginTop: 12,
  },
  diagnosticDescription: {
    fontSize: 13,
    lineHeight: 20,
  },
  modelList: {
    marginTop: 8,
  },
  modelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
  },
  modelInfo: {
    flex: 1,
  },
  modelHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  modelName: {
    fontSize: 15,
    fontWeight: '600',
  },
  modelProvider: {
    fontSize: 12,
  },
  modelDetails: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  modelMeta: {
    fontSize: 11,
  },
  themeOptions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 12,
  },
  themeOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  themeLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  footer: {
    alignItems: 'center',
    marginTop: 32,
    gap: 4,
  },
  footerText: {
    fontSize: 13,
  },
  modalDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  diagnosticPreview: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  diagnosticPreviewText: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  diagnosticActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  diagnosticActionButton: {
    flex: 1,
  },
});
