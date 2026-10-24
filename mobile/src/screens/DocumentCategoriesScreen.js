import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
  RefreshControl, Modal, TextInput, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { documentsApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { useNotifications } from '../context/NotificationContext';

const MANAGER_ROLES = ['owner', 'admin', 'shop_chief', 'section_chief', 'master', 'assistant_master'];

export default function DocumentCategoriesScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser } = useNotifications();
  const isManager = currentUser && MANAGER_ROLES.includes(currentUser.role);

  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const loadCategories = useCallback(async () => {
    try {
      const res = await documentsApi.getCategories();
      setCategories(res.data || []);
    } catch (err) {
      console.log('[DocumentCategoriesScreen] load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadCategories(); }, [loadCategories]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadCategories();
    setRefreshing(false);
  };

  const openCreateModal = () => {
    setEditingCategory(null);
    setTitle('');
    setDescription('');
    setModalVisible(true);
  };

  const openEditModal = (category) => {
    setEditingCategory(category);
    setTitle(category.title);
    setDescription(category.description || '');
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Ошибка', 'Введите название категории');
      return;
    }
    setSaving(true);
    try {
      if (editingCategory) {
        await documentsApi.updateCategory(editingCategory.id, { title: title.trim(), description: description.trim() || null });
      } else {
        await documentsApi.createCategory({ title: title.trim(), description: description.trim() || null });
      }
      setModalVisible(false);
      await loadCategories();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось сохранить категорию');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (category) => {
    Alert.alert('Удаление категории', `Удалить категорию «${category.title}»?`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          try {
            await documentsApi.deleteCategory(category.id);
            setCategories((prev) => prev.filter((c) => c.id !== category.id));
          } catch (err) {
            Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось удалить категорию');
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      activeOpacity={0.85}
      onPress={() => navigation.navigate('DocumentsList', { categoryId: item.id, categoryTitle: item.title })}
    >
      <View style={styles.cardIcon}>
        <Icon name="folder" size={28} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{item.title}</Text>
        {!!item.description && (
          <Text style={[styles.cardDescription, { color: colors.textSecondary }]} numberOfLines={2}>
            {item.description}
          </Text>
        )}
        <Text style={[styles.cardCount, { color: colors.textSecondary }]}>
          Документов: {item.documents_count || 0}
        </Text>
      </View>
      {isManager && (
        <View style={styles.cardActions}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => openEditModal(item)}>
            <Icon name="create-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => handleDelete(item)}>
            <Icon name="trash-outline" size={20} color={colors.error || '#e53935'} />
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {isManager && (
        <View style={styles.topBar}>
          <TouchableOpacity style={[styles.createButton, { backgroundColor: colors.primary }]} onPress={openCreateModal}>
            <Icon name="add" size={20} color="#fff" />
            <Text style={styles.createButtonText}>Новая категория</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={categories}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="folder-open-outline" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Категорий пока нет</Text>
            </View>
          }
        />
      )}

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {editingCategory ? 'Редактировать категорию' : 'Новая категория'}
            </Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="Название"
              placeholderTextColor={colors.textSecondary}
              value={title}
              onChangeText={setTitle}
            />
            <TextInput
              style={[styles.input, styles.textArea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="Описание (необязательно)"
              placeholderTextColor={colors.textSecondary}
              value={description}
              onChangeText={setDescription}
              multiline
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, { borderColor: colors.border }]} onPress={() => setModalVisible(false)}>
                <Text style={{ color: colors.text }}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: 'bold' }}>Сохранить</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  topBar: { padding: 16, paddingBottom: 0 },
  createButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: 10,
  },
  createButtonText: { color: '#fff', fontWeight: 'bold', marginLeft: 6 },
  listContent: { padding: 16 },
  card: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1,
    padding: 14, marginBottom: 12,
  },
  cardIcon: { marginRight: 12 },
  cardTitle: { fontSize: 16, fontWeight: 'bold' },
  cardDescription: { fontSize: 13, marginTop: 2 },
  cardCount: { fontSize: 12, marginTop: 4 },
  cardActions: { flexDirection: 'row' },
  iconBtn: { padding: 6, marginLeft: 4 },
  emptyContainer: { alignItems: 'center', marginTop: 60 },
  emptyText: { marginTop: 12, fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalCard: { borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: 'bold', marginBottom: 16 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, marginBottom: 12 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  modalBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1, marginLeft: 10 },
});
