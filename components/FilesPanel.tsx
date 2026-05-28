import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {
  FileText,
  Trash2,
  Upload,
  CircleAlert as AlertCircle,
  ChevronDown,
  ChevronRight,
  Info,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { ProjectFile, ProjectFileChunk } from '@/types';
import { formatFileSize } from '@/utils/fileImport';
import { Button } from './Button';

type IncludeMode = 'auto' | 'summary_only' | 'full';

interface FilesPanelProps {
  files: ProjectFile[];
  onAddFile: () => Promise<void>;
  onDeleteFile: (id: string) => Promise<void>;
  onToggleFile: (id: string, enabled: boolean) => Promise<void>;
  onChangeMode: (id: string, mode: IncludeMode) => Promise<void>;
  onLoadChunks: (fileId: string) => Promise<ProjectFileChunk[]>;
  loading?: boolean;
}

const MODE_LABELS: Record<IncludeMode, string> = {
  auto: 'Auto',
  summary_only: 'Summary only',
  full: 'Full file',
};

const MODE_DESCRIPTIONS: Record<IncludeMode, string> = {
  auto: 'Sends summary + most relevant excerpts',
  summary_only: 'Sends only the file summary',
  full: 'Sends the full file — uses many tokens',
};

export function FilesPanel({
  files,
  onAddFile,
  onDeleteFile,
  onToggleFile,
  onChangeMode,
  onLoadChunks,
  loading = false,
}: FilesPanelProps) {
  const { colors } = useTheme();
  const [uploading, setUploading] = useState(false);
  const [expandedFileId, setExpandedFileId] = useState<string | null>(null);
  const [chunksByFile, setChunksByFile] = useState<Record<string, ProjectFileChunk[]>>({});
  const [loadingChunks, setLoadingChunks] = useState<string | null>(null);
  const [modeMenuFileId, setModeMenuFileId] = useState<string | null>(null);

  const handleAddFile = async () => {
    setUploading(true);
    try {
      await onAddFile();
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteFile = (file: ProjectFile) => {
    Alert.alert('Delete File', `Remove "${file.name}" from this project?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDeleteFile(file.id) },
    ]);
  };

  const handleExpandChunks = async (fileId: string) => {
    if (expandedFileId === fileId) {
      setExpandedFileId(null);
      return;
    }
    setExpandedFileId(fileId);
    if (!chunksByFile[fileId]) {
      setLoadingChunks(fileId);
      try {
        const chunks = await onLoadChunks(fileId);
        setChunksByFile(prev => ({ ...prev, [fileId]: chunks }));
      } finally {
        setLoadingChunks(null);
      }
    }
  };

  const handleModeChange = async (fileId: string, mode: IncludeMode) => {
    setModeMenuFileId(null);
    await onChangeMode(fileId, mode);
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header hint */}
      <View style={[styles.hintBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
        <Info size={14} color={colors.textSecondary} />
        <Text style={[styles.hintText, { color: colors.textSecondary }]}>
          Auto mode sends the file summary plus the most relevant excerpts. Full file mode may use many tokens.
        </Text>
      </View>

      <Button
        title={uploading ? 'Importing...' : 'Import File'}
        onPress={handleAddFile}
        loading={uploading}
        disabled={uploading}
        icon={<Upload size={18} color="#FFFFFF" />}
        style={styles.uploadButton}
      />

      {files.length === 0 ? (
        <View style={styles.emptyState}>
          <FileText size={48} color={colors.textTertiary} />
          <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>No files yet</Text>
          <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>
            Import .txt, .md, .json, or .csv reference files to include them automatically in AI requests
          </Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.fileList}>
          {files.map(file => {
            const mode = (file.includeMode || 'auto') as IncludeMode;
            const isExpanded = expandedFileId === file.id;
            const chunks = chunksByFile[file.id] || [];
            const isLoadingChunks = loadingChunks === file.id;
            const isModeOpen = modeMenuFileId === file.id;

            return (
              <View
                key={file.id}
                style={[styles.fileCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                {/* File header row */}
                <View style={styles.fileHeader}>
                  <View style={[styles.fileIconWrap, { backgroundColor: colors.primaryLight }]}>
                    <FileText size={18} color={colors.primary} />
                  </View>

                  <View style={styles.fileMeta}>
                    <Text style={[styles.fileName, { color: colors.text }]} numberOfLines={1}>
                      {file.name}
                    </Text>
                    <Text style={[styles.fileSubtitle, { color: colors.textTertiary }]}>
                      {formatFileSize(file.size)}
                      {file.chunkCount !== undefined
                        ? ` · ${file.chunkCount} chunk${file.chunkCount !== 1 ? 's' : ''}`
                        : ''}
                      {file.processingStatus === 'processing' ? ' · processing...' : ''}
                      {file.processingStatus === 'error' ? ` · error` : ''}
                    </Text>
                  </View>

                  {/* Enabled toggle */}
                  <TouchableOpacity
                    onPress={() => onToggleFile(file.id, !file.enabled)}
                    style={[
                      styles.badge,
                      { backgroundColor: file.enabled ? colors.successLight : colors.surfaceSecondary },
                    ]}
                  >
                    <Text style={[styles.badgeText, { color: file.enabled ? colors.success : colors.textTertiary }]}>
                      {file.enabled ? 'ON' : 'OFF'}
                    </Text>
                  </TouchableOpacity>

                  {/* Delete */}
                  <TouchableOpacity onPress={() => handleDeleteFile(file)} style={styles.iconButton}>
                    <Trash2 size={16} color={colors.error} />
                  </TouchableOpacity>
                </View>

                {/* Summary preview */}
                {file.summary ? (
                  <Text style={[styles.summaryText, { color: colors.textSecondary }]} numberOfLines={2}>
                    {file.summary}
                  </Text>
                ) : null}

                {/* Include mode selector */}
                <View style={styles.modeRow}>
                  <Text style={[styles.modeLabel, { color: colors.textTertiary }]}>Mode:</Text>
                  <TouchableOpacity
                    style={[styles.modeSelector, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
                    onPress={() => setModeMenuFileId(isModeOpen ? null : file.id)}
                  >
                    <Text style={[styles.modeSelectorText, { color: colors.text }]}>
                      {MODE_LABELS[mode]}
                    </Text>
                    <ChevronDown size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                {/* Mode dropdown */}
                {isModeOpen && (
                  <View style={[styles.modeDropdown, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    {(Object.keys(MODE_LABELS) as IncludeMode[]).map(m => (
                      <TouchableOpacity
                        key={m}
                        style={[
                          styles.modeOption,
                          m === mode && { backgroundColor: colors.primaryLight },
                        ]}
                        onPress={() => handleModeChange(file.id, m)}
                      >
                        <Text style={[styles.modeOptionTitle, { color: m === mode ? colors.primary : colors.text }]}>
                          {MODE_LABELS[m]}
                        </Text>
                        <Text style={[styles.modeOptionDesc, { color: colors.textTertiary }]}>
                          {MODE_DESCRIPTIONS[m]}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Chunk preview toggle */}
                {(file.chunkCount ?? 0) > 0 && (
                  <TouchableOpacity
                    style={styles.chunksToggle}
                    onPress={() => handleExpandChunks(file.id)}
                  >
                    {isExpanded
                      ? <ChevronDown size={14} color={colors.primary} />
                      : <ChevronRight size={14} color={colors.primary} />}
                    <Text style={[styles.chunksToggleText, { color: colors.primary }]}>
                      {isExpanded ? 'Hide chunks' : `Preview ${file.chunkCount} chunk${(file.chunkCount ?? 0) !== 1 ? 's' : ''}`}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Chunk list */}
                {isExpanded && (
                  <View style={styles.chunkList}>
                    {isLoadingChunks ? (
                      <ActivityIndicator size="small" color={colors.primary} style={styles.chunkLoader} />
                    ) : (
                      chunks.map(chunk => (
                        <View
                          key={chunk.id}
                          style={[styles.chunkItem, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
                        >
                          <Text style={[styles.chunkTitle, { color: colors.text }]}>
                            {chunk.title || `Chunk ${chunk.index + 1}`}
                          </Text>
                          {chunk.summary ? (
                            <Text style={[styles.chunkSummary, { color: colors.textSecondary }]} numberOfLines={2}>
                              {chunk.summary}
                            </Text>
                          ) : null}
                          {chunk.keywords && chunk.keywords.length > 0 ? (
                            <Text style={[styles.chunkKeywords, { color: colors.textTertiary }]} numberOfLines={1}>
                              {chunk.keywords.slice(0, 6).join(', ')}
                            </Text>
                          ) : null}
                          <Text style={[styles.chunkSize, { color: colors.textTertiary }]}>
                            {chunk.content.length.toLocaleString()} chars
                          </Text>
                        </View>
                      ))
                    )}
                  </View>
                )}
              </View>
            );
          })}

          {/* Large file warning if any file > 50KB */}
          {files.some(f => f.size > 50000) && (
            <View style={[styles.warningBox, { borderColor: colors.warning }]}>
              <AlertCircle size={14} color={colors.warning} />
              <Text style={[styles.warningText, { color: colors.warning }]}>
                Some files are large. Use &quot;Summary only&quot; mode for rarely-needed reference material to save tokens.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  hintText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  uploadButton: {
    marginBottom: 16,
  },
  fileList: {
    gap: 12,
    paddingBottom: 24,
  },
  fileCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  fileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fileIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileMeta: {
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
  },
  fileSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  iconButton: {
    padding: 6,
  },
  summaryText: {
    fontSize: 12,
    lineHeight: 17,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modeLabel: {
    fontSize: 12,
  },
  modeSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  modeSelectorText: {
    fontSize: 12,
    fontWeight: '500',
  },
  modeDropdown: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  modeOption: {
    padding: 12,
  },
  modeOptionTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  modeOptionDesc: {
    fontSize: 11,
    marginTop: 2,
  },
  chunksToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: 2,
  },
  chunksToggleText: {
    fontSize: 12,
    fontWeight: '500',
  },
  chunkList: {
    gap: 8,
    marginTop: 4,
  },
  chunkLoader: {
    marginVertical: 8,
  },
  chunkItem: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    gap: 4,
  },
  chunkTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  chunkSummary: {
    fontSize: 11,
    lineHeight: 16,
  },
  chunkKeywords: {
    fontSize: 10,
    fontStyle: 'italic',
  },
  chunkSize: {
    fontSize: 10,
    marginTop: 2,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 48,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  emptyDesc: {
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 19,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
  },
  warningText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
  },
});
