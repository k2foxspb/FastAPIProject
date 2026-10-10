import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator,
  Modal, TextInput, TouchableWithoutFeedback, KeyboardAvoidingView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { orgApi } from '../api';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { useNotifications } from '../context/NotificationContext';
import { canManageSections } from '../constants/roles';

// Список участков конкретного цеха. Создавать/редактировать/удалять участки может
// владелец или начальник этого цеха (см. _ensure_can_manage_workshop на backend).
export default function AdminSectionsScreen({ route, navigation }) {
  const { workshopId, workshopName } = route.params || {};
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser } = useNotifications();
  const canManage = canManageSections(currentUser?.role);

  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formVisible, setFormVisible] = useState(false);
  const [editingSection, setEditingSection] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchSections = useCallback(async () => {
    try {
      const res = await orgApi.getSections(workshopId);
      setSections(res.data);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить участки');
    } finally {
      setLoading(false);
    }
  }, [workshopId]);

  useFocusEffect(
    useCallback(() => {
      navigation.setOptions({ title: workshopName ? `Участки: ${workshopName}` : 'Участки' });
      fetchSections();
    }, [fetchSections, navigation, workshopName])
  );

  const openCreateForm = () => {
    setEditingSection(null);
    setName('');
    setDescription('');
    setFormVisible(true);
  };

  const openEditForm = (section) => {
    setEditingSection(section);
    setName(section.name);
    setDescription(section.description || '');
    setFormVisible(true);
  };

  const saveSection = async () => {
    if (!name.trim()) {
      Alert.alert('Ошибка', 'Введите название участка');
      return;
    }
    setSaving(true);
    try {
      if (editingSection) {
        await orgApi.updateSection(editingSection.id, { name: name.trim(), description: description.trim() || null });
      } else {
        await orgApi.createSection({ workshop_id: workshopId, name: name.trim(), description: description.trim() || null });
      }
      setFormVisible(false);
      fetchSections();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось сохранить участок');
    } finally {
      setSaving(false);
    }
  };

  const deleteSection = (section) => {
    Alert.alert(
      'Удаление участка',
      `Удалить участок "${section.name}"?`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            try {
              await orgApi.deleteSection(section.id);
              fetchSections();
            } catch (err) {
              Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось удалить участок');
            }
          },
        },
      ]
    );
  };

  const renderSection = ({ item }) => (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardInfo}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{item.name}</Text>
        {item.description ? (
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>{item.description}</Text>
        ) : null}
      </View>
      {canManage && (
        <View style={styles.cardActions}>
          <TouchableOpacity style={styles.iconButton} onPress={() => openEditForm(item)}>
            <Icon name="create-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} onPress={() => deleteSection(item)}>
            <Icon name="trash-outline" size={20} color={colors.error} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  if (loading && sections.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={sections}
        keyExtractor={item => item.id.toString()}
        renderItem={renderSection}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={fetchSections}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Участков пока нет</Text>
        }
      />

      {canManage && (
        <TouchableOpacity style={[styles.fab, { backgroundColor: colors.primary }]} onPress={openCreateForm}>
          <Icon name="add" size={28} color="#fff" />
        </TouchableOpacity>
      )}

      <Modal visible={formVisible} transparent animationType="slide" onRequestClose={() => setFormVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setFormVisible(false)}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior="padding" style={{ width: '100%', alignItems: 'center' }}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                  <View style={styles.modalHeader}>
                    <Text style={[styles.modalTitle, { color: colors.text }]}>
                      {editingSection ? 'Редактировать участок' : 'Новый участок'}
                    </Text>
                    <TouchableOpacity onPress={() => setFormVisible(false)}>
                      <Icon name="close" size={24} color={colors.text} />
                    </TouchableOpacity>
                  </View>

                  <Text style={[styles.label, { color: colors.text }]}>Название *</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                    value={name}
                    onChangeText={setName}
                    placeholder="Название участка"
                    placeholderTextColor={colors.textSecondary}
                    autoFocus
                  />

                  <Text style={[styles.label, { color: colors.text }]}>Описание</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Необязательно"
                    placeholderTextColor={colors.textSecondary}
                  />

                  <TouchableOpacity
                    style={[styles.saveButton, { backgroundColor: colors.primary }]}
                    onPress={saveSection}
                    disabled={saving}
                  >
                    {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Сохранить</Text>}
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 15, paddingBottom: 90 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
  },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: 'bold' },
  cardSubtitle: { fontSize: 13, marginTop: 4 },
  cardActions: { flexDirection: 'row' },
  iconButton: { padding: 6, marginLeft: 4 },
  emptyText: { textAlign: 'center', marginTop: 50, fontSize: 16 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
  },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { width: '100%', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  modalTitle: { fontSize: 18, fontWeight: 'bold' },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 15 },
  saveButton: { marginTop: 20, padding: 14, borderRadius: 10, alignItems: 'center' },
  saveButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
