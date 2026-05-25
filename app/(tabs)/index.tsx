import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Plus, MoveVertical as MoreVertical, Trash2, CreditCard as Edit2 } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useApp } from '@/contexts/AppContext';
import { Button, Input, Modal, EmptyState, Card, LoadingIndicator } from '@/components';
import { formatDate } from '@/utils/helpers';
import { Project } from '@/types';

export default function ProjectsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const {
    projects,
    loadingProjects,
    loadProjects,
    createProject,
    deleteProject,
    selectProject,
  } = useApp();

  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadProjects();
    }, [loadProjects])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProjects();
    setRefreshing(false);
  }, [loadProjects]);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    setCreating(true);
    try {
      const project = await createProject(newProjectName.trim());
      setModalVisible(false);
      setNewProjectName('');
      selectProject(project);
      router.push(`/project/${project.id}`);
    } finally {
      setCreating(false);
    }
  };

  const handleOpenProject = (project: Project) => {
    selectProject(project);
    router.push(`/project/${project.id}`);
  };

  const handleDeleteProject = (project: Project) => {
    Alert.alert(
      'Delete Project',
      `Are you sure you want to delete "${project.name}"? This will also delete all messages and memories associated with this project. This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteProject(project.id);
            setMenuProjectId(null);
          },
        },
      ]
    );
  };

  const renderProject = ({ item }: { item: Project }) => (
    <TouchableOpacity
      style={[styles.projectItem, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => handleOpenProject(item)}
      activeOpacity={0.7}
    >
      <View style={styles.projectContent}>
        <Text style={[styles.projectName, { color: colors.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.projectDate, { color: colors.textSecondary }]}>
          Updated {formatDate(item.updatedAt)}
        </Text>
        {item.systemPrompt ? (
          <Text style={[styles.projectHint, { color: colors.textTertiary }]} numberOfLines={1}>
            System prompt configured
          </Text>
        ) : null}
      </View>
      <TouchableOpacity
        style={styles.menuButton}
        onPress={() => setMenuProjectId(menuProjectId === item.id ? null : item.id)}
      >
        <MoreVertical size={20} color={colors.textSecondary} />
      </TouchableOpacity>
      {menuProjectId === item.id && (
        <View style={[styles.menu, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuProjectId(null);
              handleOpenProject(item);
            }}
          >
            <Edit2 size={16} color={colors.textSecondary} />
            <Text style={[styles.menuItemText, { color: colors.text }]}>Open</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => handleDeleteProject(item)}
          >
            <Trash2 size={16} color={colors.error} />
            <Text style={[styles.menuItemText, { color: colors.error }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );

  if (loadingProjects && !refreshing) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <LoadingIndicator fullScreen />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Projects</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Your creative writing workspace
        </Text>
      </View>

      {projects.length === 0 ? (
        <EmptyState
          icon={Plus}
          title="No projects yet"
          description="Create your first project to start writing with AI assistance"
          action={
            <Button
              title="Create Project"
              onPress={() => setModalVisible(true)}
              icon={<Plus size={20} color="#FFFFFF" />}
            />
          }
        />
      ) : (
        <>
          <TouchableOpacity
            style={[styles.fab, { backgroundColor: colors.primary }]}
            onPress={() => setModalVisible(true)}
            activeOpacity={0.8}
          >
            <Plus size={24} color="#FFFFFF" />
          </TouchableOpacity>

          <FlatList
            data={projects}
            renderItem={renderProject}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
          />
        </>
      )}

      <Modal
        visible={modalVisible}
        onClose={() => {
          setModalVisible(false);
          setNewProjectName('');
        }}
        title="New Project"
      >
        <Text style={[styles.modalLabel, { color: colors.text }]}>Project Name</Text>
        <Input
          value={newProjectName}
          onChangeText={setNewProjectName}
          placeholder="e.g., Fantasy Novel, Short Story #3"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleCreateProject}
          containerStyle={styles.modalInput}
        />
        <Button
          title="Create"
          onPress={handleCreateProject}
          loading={creating}
          disabled={!newProjectName.trim()}
          style={styles.modalButton}
        />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 20,
    paddingTop: 60,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
  },
  list: {
    padding: 16,
    paddingTop: 0,
    paddingBottom: 100,
  },
  projectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    position: 'relative',
  },
  projectContent: {
    flex: 1,
  },
  projectName: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
  },
  projectDate: {
    fontSize: 14,
  },
  projectHint: {
    fontSize: 13,
    marginTop: 4,
  },
  menuButton: {
    padding: 8,
    marginLeft: 8,
  },
  menu: {
    position: 'absolute',
    right: 8,
    top: 50,
    borderRadius: 8,
    borderWidth: 1,
    padding: 4,
    minWidth: 100,
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 8,
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: '500',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 100,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 100,
  },
  modalLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  modalInput: {
    marginBottom: 16,
  },
  modalButton: {
    marginTop: 8,
  },
});
