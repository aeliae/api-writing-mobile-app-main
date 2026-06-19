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
import { Monitor, Moon, Sun, Check, Eye, EyeOff, ExternalLink } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useApp } from '@/contexts/AppContext';
import { Button, Input, Card, CardHeader, LoadingIndicator, Modal } from '@/components';
import { AVAILABLE_MODELS } from '@/types';
import { getStorageDiagnostics } from '@/services/storage';

export default function SettingsScreen() {
  const { colors, mode, setThemeMode } = useTheme();
  const { settings, loadingSettings, loadSettings, updateSettings } = useApp();

  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedModel, setSelectedModel] = useState(settings.selectedModel);
  const [diagnosticModalVisible, setDiagnosticModalVisible] = useState(false);
  const [runningDiagnostic, setRunningDiagnostic] = useState(false);
  const [diagnosticSummary, setDiagnosticSummary] = useState('');
  const [diagnosticExportText, setDiagnosticExportText] = useState('');

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
    </ScrollView>
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
