import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator,
  Modal, TextInput, TouchableWithoutFeedback, KeyboardAvoidingView, ScrollView,
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

// Набор иконок (Ionicons), из которых можно выбрать иконку должности - она
// же потом отображается в профиле сотрудника с этой должностью.
const ICON_OPTIONS = [
  'ribbon', 'business', 'briefcase', 'construct', 'hammer', 'hardware-chip',
  'shield-checkmark', 'storefront', 'person', 'people', 'star', 'medal',
  'build', 'cog', 'school', 'book', 'car', 'cube', 'flash', 'leaf',
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
  const [level, setLevel] = useState('');
  const [scope, setScope] = useState('section');
  const [icon, setIcon] = useState(ICON_OPTIONS[0]);
  const [saving, setSaving] = useState(false);
  const [scopePickerVisible, setScopePickerVisible] = useState(false);

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
    const maxLevel = positions.reduce((max, p) => Math.max(max, p.level), -1);
    setLevel(String(maxLevel + 1));
    setScope('section');
    setIcon(ICON_OPTIONS[0]);
    setFormVisible(true);
  };

  const openEditForm = (position) => {
    setEditingPosition(position);
    setName(position.name);
    setLevel(String(position.level));
    setScope(position.scope);
    setIcon(position.icon || ICON_OPTIONS[0]);
    setFormVisible(true);
  };

  // Вариантов области ответственности 4 штуки + отмена - на Android системный
  // Alert.alert не показывает больше 3 кнопок, из-за чего вариант "Только себя"
  // было невозможно выбрать - вместо этого используем своё модальное окно со списком.
  const chooseScope = () => {
    setScopePickerVisible(true);
  };

  const selectScope = (value) => {
    setScope(value);
    setScopePickerVisible(false);
  };

  const savePosition = async () => {
    if (!name.trim()) {
      Alert.alert('Ошибка', 'Введите название должности');
      return;
    }
    const levelNumber = parseInt(level, 10);
    if (Number.isNaN(levelNumber)) {
      Alert.alert('Ошибка', 'Укажите уровень должности (число)');
      return;
    }
    setSaving(true);
    try {
      if (editingPosition) {
        await orgApi.updatePosition(editingPosition.id, { name: name.trim(), scope, level: levelNumber, icon });
      } else {
        await orgApi.createPosition({ name: name.trim(), scope, level: levelNumber, icon });
      }
      setFormVisible(false);
      await fetchPositions();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось сохранить должность');
    } finally {
      setSaving(false);
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

  const renderPosition = ({ item }) => (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.positionIconWrap, { backgroundColor: colors.background }]}>
        <Icon name={item.icon || getRoleIcon(item.code)} size={20} color={colors.primary} />
      </View>
      <View style={styles.cardInfo}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{item.name}</Text>
        <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
          Уровень {item.level} · {getScopeLabel(item.scope)}
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
        Должности отсортированы от самой высокой к самой низкой. Место в иерархии задаётся полем "Уровень".
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
                <View style={[styles.modalContent, { backgroundColor: colors.surface, maxHeight: '85%' }]}>
                  <View style={styles.modalHeader}>
                    <Text style={[styles.modalTitle, { color: colors.text }]}>
                      {editingPosition ? 'Редактировать должность' : 'Новая должность'}
                    </Text>
                    <TouchableOpacity onPress={() => setFormVisible(false)}>
                      <Icon name="close" size={24} color={colors.text} />
                    </TouchableOpacity>
                  </View>

                  <ScrollView showsVerticalScrollIndicator={false}>
                    <Text style={[styles.label, { color: colors.text }]}>Название *</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                      value={name}
                      onChangeText={setName}
                      placeholder="Например, Технолог"
                      placeholderTextColor={colors.textSecondary}
                      autoFocus
                    />

                    <Text style={[styles.label, { color: colors.text }]}>Уровень *</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                      value={level}
                      onChangeText={(v) => setLevel(v.replace(/[^0-9-]/g, ''))}
                      placeholder="0"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="numeric"
                    />
                    <Text style={[styles.hintSmall, { color: colors.textSecondary }]}>
                      Чем меньше число - тем выше должность. На одном уровне может быть любое количество должностей.
                    </Text>

                    <Text style={[styles.label, { color: colors.text }]}>Область ответственности</Text>
                    <TouchableOpacity
                      style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, justifyContent: 'center' }]}
                      onPress={chooseScope}
                    >
                      <Text style={{ color: colors.text }}>{getScopeLabel(scope)}</Text>
                    </TouchableOpacity>

                    <Text style={[styles.label, { color: colors.text }]}>Иконка</Text>
                    <View style={styles.iconGrid}>
                      {ICON_OPTIONS.map((opt) => (
                        <TouchableOpacity
                          key={opt}
                          style={[
                            styles.iconOption,
                            {
                              backgroundColor: icon === opt ? colors.primary : colors.card,
                              borderColor: colors.border,
                            },
                          ]}
                          onPress={() => setIcon(opt)}
                        >
                          <Icon name={opt} size={20} color={icon === opt ? '#fff' : colors.primary} />
                        </TouchableOpacity>
                      ))}
                    </View>

                    <TouchableOpacity
                      style={[styles.saveButton, { backgroundColor: colors.primary }]}
                      onPress={savePosition}
                      disabled={saving}
                    >
                      {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Сохранить</Text>}
                    </TouchableOpacity>
                  </ScrollView>
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal visible={scopePickerVisible} transparent animationType="fade" onRequestClose={() => setScopePickerVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setScopePickerVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.pickerContent, { backgroundColor: colors.surface }]}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Область ответственности</Text>
                  <TouchableOpacity onPress={() => setScopePickerVisible(false)}>
                    <Icon name="close" size={24} color={colors.text} />
                  </TouchableOpacity>
                </View>
                {SCOPE_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.scopeRow, { borderColor: colors.border }]}
                    onPress={() => selectScope(opt.value)}
                  >
                    <Text style={{ color: scope === opt.value ? colors.primary : colors.text, fontSize: 16, fontWeight: scope === opt.value ? '700' : '500' }}>
                      {opt.label}
                    </Text>
                    {scope === opt.value && <Icon name="checkmark" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableWithoutFeedback>
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
  hintSmall: { fontSize: 12, marginTop: 4 },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  iconOption: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginBottom: 10,
  },
  saveButton: { marginTop: 20, padding: 14, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
  saveButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  pickerContent: { width: '100%', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  scopeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
});
