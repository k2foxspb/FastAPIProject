import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator,
  Modal, TouchableWithoutFeedback,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { actingApi, orgApi } from '../api';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { useNotifications } from '../context/NotificationContext';
import { getRoleLabel, loadPositions } from '../constants/roles';
import { formatName } from '../utils/formatters';

// Экран назначения исполняющего обязанности (и.о.) на должность другого
// сотрудника (см. POST/GET/DELETE /acting/assignments). Назначать может
// только вышестоящий как над замещаемой должностью, так и над собственной
// должностью назначаемого и.о. - окончательную проверку всегда делает
// сервер (app/core/roles.py: can_assign_acting), здесь только UI.
export default function ActingAssignmentsScreen() {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser } = useNotifications();

  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState(null);
  const [pickerState, setPickerState] = useState(null);

  const showChoice = (title, options, message) => new Promise((resolve) => {
    if (!options.length) {
      resolve(null);
      return;
    }
    setPickerState({ title, message, options, resolve });
  });

  const resolvePicker = (value) => {
    const resolve = pickerState?.resolve;
    setPickerState(null);
    if (resolve) resolve(value);
  };

  const fetchAssignments = useCallback(async () => {
    try {
      const res = await actingApi.getAssignments(false);
      setAssignments(res.data);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить назначения и.о.');
    } finally {
      setLoading(false);
    }
    loadPositions();
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchAssignments();
    }, [fetchAssignments])
  );

  const startCreateAssignment = async () => {
    let roles;
    try {
      const rolesRes = await orgApi.getAssignableRoles();
      roles = rolesRes.data;
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось получить список доступных должностей');
      return;
    }
    if (!roles || roles.length === 0) {
      Alert.alert('Недоступно', 'У вас нет прав назначать и.о. на какую-либо должность');
      return;
    }

    const actingRole = await showChoice('На какую должность назначить и.о.?', roles.map(r => ({ label: r.label, value: r.value })));
    if (!actingRole) return;

    let employees;
    try {
      const employeesRes = await orgApi.getEmployees();
      employees = employeesRes.data.filter(e => e.id !== currentUser?.id);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось получить список сотрудников');
      return;
    }
    if (employees.length === 0) {
      Alert.alert('Недоступно', 'Нет доступных сотрудников для назначения');
      return;
    }

    const assigneeId = await showChoice(
      'Кто будет исполнять обязанности?',
      employees.map(e => ({ label: `${formatName(e)} (${getRoleLabel(e.role)})`, value: e.id })),
    );
    if (!assigneeId) return;

    const assignee = employees.find(e => e.id === assigneeId);

    Alert.alert(
      'Подтверждение',
      `Назначить ${formatName(assignee)} исполняющим обязанности «${getRoleLabel(actingRole)}»?`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Назначить',
          onPress: async () => {
            setCreating(true);
            try {
              await actingApi.createAssignment({
                user_id: assigneeId,
                acting_role: actingRole,
                acting_workshop_id: currentUser?.workshop_id ?? null,
                acting_section_id: currentUser?.section_id ?? null,
              });
              await fetchAssignments();
            } catch (err) {
              const detail = err?.response?.data?.detail;
              Alert.alert('Ошибка', typeof detail === 'string' ? detail : 'Не удалось создать назначение');
            } finally {
              setCreating(false);
            }
          },
        },
      ]
    );
  };

  const revokeAssignment = (assignment) => {
    Alert.alert(
      'Отозвать назначение?',
      `Назначение «${getRoleLabel(assignment.acting_role)}» будет отозвано досрочно.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Отозвать',
          style: 'destructive',
          onPress: async () => {
            setRevokingId(assignment.id);
            try {
              await actingApi.revokeAssignment(assignment.id);
              await fetchAssignments();
            } catch (err) {
              const detail = err?.response?.data?.detail;
              Alert.alert('Ошибка', typeof detail === 'string' ? detail : 'Не удалось отозвать назначение');
            } finally {
              setRevokingId(null);
            }
          },
        },
      ]
    );
  };

  const formatDate = (value) => {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleDateString('ru-RU');
    } catch {
      return value;
    }
  };

  const renderItem = ({ item }) => (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardInfo}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{getRoleLabel(item.acting_role)}</Text>
        <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
          С {formatDate(item.starts_at)} {item.ends_at ? `по ${formatDate(item.ends_at)}` : '(бессрочно)'}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.revokeBtn}
        onPress={() => revokeAssignment(item)}
        disabled={revokingId === item.id}
      >
        {revokingId === item.id ? (
          <ActivityIndicator color={colors.error} />
        ) : (
          <Icon name="close-circle-outline" size={24} color={colors.error} />
        )}
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={assignments}
        keyExtractor={item => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Активных назначений и.о. нет
          </Text>
        }
      />

      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={startCreateAssignment}
        disabled={creating}
      >
        {creating ? <ActivityIndicator color="#fff" /> : <Icon name="person-add-outline" size={26} color="#fff" />}
      </TouchableOpacity>

      <Modal visible={!!pickerState} transparent animationType="fade" onRequestClose={() => resolvePicker(null)}>
        <TouchableWithoutFeedback onPress={() => resolvePicker(null)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.pickerContent, { backgroundColor: colors.surface }]}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>{pickerState?.title}</Text>
                  <TouchableOpacity onPress={() => resolvePicker(null)}>
                    <Icon name="close" size={24} color={colors.text} />
                  </TouchableOpacity>
                </View>
                {!!pickerState?.message && (
                  <Text style={[styles.label, { color: colors.textSecondary, marginTop: 0 }]}>{pickerState.message}</Text>
                )}
                <FlatList
                  data={pickerState?.options || []}
                  keyExtractor={(item, index) => `${item.value}-${index}`}
                  style={styles.pickerList}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[styles.pickerRow, { borderColor: colors.border }]}
                      onPress={() => resolvePicker(item.value)}
                    >
                      <Text style={[styles.cardTitle, { color: colors.text }]}>{item.label}</Text>
                    </TouchableOpacity>
                  )}
                />
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
  list: { padding: 15, paddingBottom: 90 },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
  },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '500' },
  cardSubtitle: { fontSize: 12, marginTop: 4 },
  revokeBtn: { paddingLeft: 10 },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerContent: {
    width: '85%',
    maxHeight: '70%',
    borderRadius: 12,
    padding: 15,
  },
  pickerList: { marginTop: 10 },
  pickerRow: { paddingVertical: 12, borderBottomWidth: 1 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 16, fontWeight: 'bold' },
  label: { fontSize: 13, marginTop: 8 },
});
