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
import { loadPositions, getRoleIcon } from '../constants/roles';

const SCOPE_OPTIONS = [
  { value: 'global', label: 'Вся система' },
  { value: 'workshop', label: 'Цех' },
  { value: 'section', label: 'Участок' },
  { value: 'self', label: 'Только себя (рядовой сотрудник)' },
];

const getScopeLabel = (scope) => SCOPE_OPTIONS.find(o => o.value === scope)?.label || scope;

// Список должностей производственной иерархии. Должности больше не
// захардкожены в коде - владелец может создавать новые, менять их название,
// область ответственности и место в иерархии (см. GET/POST/PATCH /org/positions
// в app/api/routers/structure.py). Системную должность "Владелец" удалить
// нельзя - на ней завязана часть бизнес-логики. На самом нижнем уровне
// (область "Только себя") можно создать сколько угодно разных должностей -
// они делят один и тот же уровень иерархии и равноправны между собой.
export default function AdminPositionsScreen() {
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formVisible, setFormVisible] = useState(false);
  const [editingPosition, setEditingPosition] = useState(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [scope, setScope] = useState('section');
  const [saving, setSaving] = useState(false);

  const fetchPositions = useCallback(async () => {
    try {
      const res = await orgApi.getPositions();
      setPositions(res.data);
      loadPositions();
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить должности');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchPositions();
    }, [fetchPositions])
  );

  const openCreateForm = () => {
    setEditingPosition(null);
    setName('');
    setCode('');
    setScope('section');
    setFormVisible(true);
  };

  const openEditForm = (position) => {
    setEditingPosition(position);
    setName(position.name);
    setCode(position.code);
    setScope(position.scope);
    setFormVisible(true);
  };

  const chooseScope = () => {
    Alert.alert(
      'Область ответственности',
      undefined,
      [
        ...SCOPE_OPTIONS.map(opt => ({ text: opt.label, onPress: () => setScope(opt.value) })),
        { text: 'Отмена', style: 'cancel' },
      ]
    );
  };

  const savePosition = async () => {
    if (!name.trim()) {
      Alert.alert('Ошибка', 'Введите название должности');
      return;
    }
    if (!editingPosition && !/^[a-z][a-z0-9_]*$/.test(code.trim())) {
      Alert.alert('Ошибка', 'Код должности: латиница в нижнем регистре, цифры и "_", начинается с буквы');
      return;
    }
    setSaving(true);
    try {
      if (editingPosition) {
        await orgApi.updatePosition(editingPosition.id, { name: name.trim(), scope });
      } else {
        await orgApi.createPosition({ code: code.trim(), name: name.trim(), scope });
      }
      setFormVisible(false);
      await fetchPositions();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось сохранить должность');
    } finally {
      setSaving(false);
    }
  };

  const movePosition = async (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= positions.length) return;

    const reordered = [...positions];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];

    // Должностям со scope="self" (самый нижний уровень) нельзя назначать
    // отдельный уникальный level на каждую - они все делят один и тот же
    // (самый низкий) уровень, иначе неограниченное число должностей на
    // нижнем уровне развалилось бы при первой же перестановке.
    let level = 0;
    let selfLevel = null;
    const payload = reordered.map((p) => {
      if (p.scope === 'self') {
        if (selfLevel === null) {
          selfLevel = level;
          level += 1;
        }
        return { id: p.id, level: selfLevel };
      }
      const assignedLevel = level;
      level += 1;
      return { id: p.id, level: assignedLevel };
    });

    try {
      await orgApi.reorderPositions(payload);
      await fetchPositions();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось изменить иерархию');
    }
  };

  const deletePosition = (position) => {
    Alert.alert(
      'Удаление должности',
      `Удалить должность "${position.name}"?`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            try {
              await orgApi.deletePosition(position.id);
              await fetchPositions();
            } catch (err) {
              Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось удалить должность');
            }
          },
        },
      ]
    );
  };

  const renderPosition = ({ item, index }) => (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.moveColumn}>
        <TouchableOpacity disabled={index === 0} onPress={() => movePosition(index, -1)}>
          <Icon name="chevron-up" size={20} color={index === 0 ? colors.border : colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity disabled={index === positions.length - 1} onPress={() => movePosition(index, 1)}>
          <Icon name="chevron-down" size={20} color={index === positions.length - 1 ? colors.border : colors.primary} />
        </TouchableOpacity>
      </View>
      <View style={[styles.positionIconWrap, { backgroundColor: colors.background }]}>
        <Icon name={getRoleIcon(item.code)} size={20} color={colors.primary} />
      </View>
      <View style={styles.cardInfo}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{item.name}</Text>
        <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
          Код: {item.code} · {getScopeLabel(item.scope)}
        </Text>
      </View>
      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.iconButton} onPress={() => openEditForm(item)}>
          <Icon name="create-outline" size={20} color={colors.primary} />
        </TouchableOpacity>
        {!item.is_system && (
          <TouchableOpacity style={styles.iconButton} onPress={() => deletePosition(item)}>
            <Icon name="trash-outline" size={20} color={colors.error} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  if (loading && positions.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        Должности отсортированы от самой высокой к самой низкой. Стрелками можно менять их место в иерархии.
      </Text>
      <FlatList
        data={positions}
        keyExtractor={item => item.id.toString()}
        renderItem={renderPosition}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={fetchPositions}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Должностей пока нет</Text>
        }
      />

      <TouchableOpacity style={[styles.fab, { backgroundColor: colors.primary }]} onPress={openCreateForm}>
        <Icon name="add" size={28} color="#fff" />
      </TouchableOpacity>

      <Modal visible={formVisible} transparent animationType="slide" onRequestClose={() => setFormVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setFormVisible(false)}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior="padding" style={{ width: '100%', alignItems: 'center' }}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                  <View style={styles.modalHeader}>
                    <Text style={[styles.modalTitle, { color: colors.text }]}>
                      {editingPosition ? 'Редактировать должность' : 'Новая должность'}
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
                    placeholder="Например, Технолог"
                    placeholderTextColor={colors.textSecondary}
                    autoFocus
                  />

                  {!editingPosition && (
                    <>
                      <Text style={[styles.label, { color: colors.text }]}>Код *</Text>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                        value={code}
                        onChangeText={(v) => setCode(v.toLowerCase())}
                        placeholder="technologist"
                        placeholderTextColor={colors.textSecondary}
                        autoCapitalize="none"
                      />
                    </>
                  )}

                  <Text style={[styles.label, { color: colors.text }]}>Область ответственности</Text>
                  <TouchableOpacity
                    style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, justifyContent: 'center' }]}
                    onPress={chooseScope}
                  >
                    <Text style={{ color: colors.text }}>{getScopeLabel(scope)}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.saveButton, { backgroundColor: colors.primary }]}
                    onPress={savePosition}
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
  hint: { fontSize: 13, paddingHorizontal: 15, paddingTop: 15 },
  list: { padding: 15, paddingBottom: 90 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
  },
  moveColumn: { marginRight: 10, alignItems: 'center' },
  positionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: 'bold' },
  cardSubtitle: { fontSize: 13, marginTop: 4 },
  cardActions: { flexDirection: 'row', marginLeft: 8 },
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
