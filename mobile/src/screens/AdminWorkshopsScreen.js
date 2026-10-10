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
import { canManageWorkshops } from '../constants/roles';

// Список цехов. Создавать/редактировать/удалять цеха может только владелец
// (см. app/api/routers/structure.py: create_workshop/update_workshop/delete_workshop
// зависят от get_current_owner) - начальник цеха лишь видит свой цех и переходит
// в него для управления участками.
export default function AdminWorkshopsScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser } = useNotifications();
  const canManage = canManageWorkshops(currentUser?.role);

  const [workshops, setWorkshops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formVisible, setFormVisible] = useState(false);
  const [editingWorkshop, setEditingWorkshop] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchWorkshops = useCallback(async () => {
    try {
      const res = await orgApi.getWorkshops();
      setWorkshops(res.data);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить цеха');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchWorkshops();
    }, [fetchWorkshops])
  );

  const openCreateForm = () => {
    setEditingWorkshop(null);
    setName('');
    setDescription('');
    setFormVisible(true);
  };

  const openEditForm = (workshop) => {
    setEditingWorkshop(workshop);
    setName(workshop.name);
    setDescription(workshop.description || '');
    setFormVisible(true);
  };

  const saveWorkshop = async () => {
    if (!name.trim()) {
      Alert.alert('Ошибка', 'Введите название цеха');
      return;
    }
    setSaving(true);
    try {
      if (editingWorkshop) {
        await orgApi.updateWorkshop(editingWorkshop.id, { name: name.trim(), description: description.trim() || null });
      } else {
        await orgApi.createWorkshop({ name: name.trim(), description: description.trim() || null });
      }
      setFormVisible(false);
      fetchWorkshops();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось сохранить цех');
    } finally {
      setSaving(false);
    }
  };

  const deleteWorkshop = (workshop) => {
    Alert.alert(
      'Удаление цеха',
      `Удалить цех "${workshop.name}"? Все его участки также будут удалены.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            try {
              await orgApi.deleteWorkshop(workshop.id);
              fetchWorkshops();
            } catch (err) {
              Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось удалить цех');
            }
          },
        },
      ]
    );
  };

  const renderWorkshop = ({ item }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => navigation.navigate('AdminSections', { workshopId: item.id, workshopName: item.name })}
    >
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
          <TouchableOpacity style={styles.iconButton} onPress={() => deleteWorkshop(item)}>
            <Icon name="trash-outline" size={20} color={colors.error} />
          </TouchableOpacity>
        </View>
      )}
      <Icon name="chevron-forward" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  if (loading && workshops.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={workshops}
        keyExtractor={item => item.id.toString()}
        renderItem={renderWorkshop}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={fetchWorkshops}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Цехов пока нет</Text>
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
                      {editingWorkshop ? 'Редактировать цех' : 'Новый цех'}
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
                    placeholder="Название цеха"
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
                    onPress={saveWorkshop}
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
  cardActions: { flexDirection: 'row', marginRight: 8 },
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
