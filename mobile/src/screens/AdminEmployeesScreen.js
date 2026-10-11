import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator,
  Modal, TextInput, TouchableWithoutFeedback, KeyboardAvoidingView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { orgApi, usersApi } from '../api';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { useNotifications } from '../context/NotificationContext';
import { getRoleLabel, getRoleScope, loadPositions, ROLE_LABELS_RU } from '../constants/roles';
import { formatName } from '../utils/formatters';

// Показывает список сотрудников, видимых текущему пользователю в его зоне
// ответственности (см. GET /org/employees), и позволяет создавать сотрудников,
// менять им роль, назначать в цех/участок, перемещать рабочих и удалять -
// всё строго в пределах ролей, которые разрешено назначать текущему пользователю
// (см. can_assign_role/can_manage_user/can_move_worker в app/core/roles.py).
// Выбор между выбором цеха/участка делается не по захардкоженному списку кодов, а по
// полю scope выбранной должности (см. getRoleScope в constants/roles.js), чтобы новые
// должности, созданные владельцем на экране "Должности", тоже работали без изменения кода.

export default function AdminEmployeesScreen() {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser } = useNotifications();

  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  const [formVisible, setFormVisible] = useState(false);
  const [pendingRole, setPendingRole] = useState(null);
  const [pendingWorkshopId, setPendingWorkshopId] = useState(null);
  const [pendingSectionId, setPendingSectionId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [assigningUserId, setAssigningUserId] = useState(null);
  const [pickerState, setPickerState] = useState(null);

  // Показывает модальное окно с прокручиваемым списком вариантов и возвращает
  // промис с выбранным значением (или null, если отменили). Раньше здесь использовался
  // Alert.alert, но он показывает не больше 2-3 вариантов одновременно, из-за чего при
  // большем количестве должностей часть списка просто не показывалась.
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

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await orgApi.getEmployees();
      setEmployees(res.data);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить сотрудников');
    } finally {
      setLoading(false);
    }
    // Подгружаем актуальный список должностей (включая созданные владельцем
    // пользовательские), чтобы список ролей для назначения и проверки scope
    // были всегда свежими, а не из кэша прошлой сессии.
    loadPositions();
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchEmployees();
    }, [fetchEmployees])
  );

  // --- Создание сотрудника ---

  const startCreateEmployee = async () => {
    let roles;
    try {
      const rolesRes = await orgApi.getAssignableRoles();
      roles = rolesRes.data;
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось получить список доступных ролей');
      return;
    }
    if (!roles || roles.length === 0) {
      Alert.alert('Недоступно', 'У вас нет прав назначать новые роли');
      return;
    }

    const role = await showChoice('Выберите роль', roles.map(r => ({ label: r.label, value: r.value })));
    if (!role) return;

    let workshopId = null;
    let sectionId = null;

    if (getRoleScope(role) === 'workshop') {
      const wsRes = await orgApi.getWorkshops();
      const workshops = wsRes.data;
      if (workshops.length === 0) {
        Alert.alert('Нет цехов', 'Сначала создайте цех в разделе "Цеха и участки"');
        return;
      }
      workshopId = await showChoice('Выберите цех', workshops.map(w => ({ label: w.name, value: w.id })));
      if (!workshopId) return;
    } else if (getRoleScope(role) === 'section') {
      if (getRoleScope(currentUser.role) === 'global') {
        const wsRes = await orgApi.getWorkshops();
        const workshops = wsRes.data;
        if (workshops.length === 0) {
          Alert.alert('Нет цехов', 'Сначала создайте цех и участок в разделе "Цеха и участки"');
          return;
        }
        workshopId = await showChoice('Выберите цех', workshops.map(w => ({ label: w.name, value: w.id })));
        if (!workshopId) return;

        const secRes = await orgApi.getSections(workshopId);
        const sections = secRes.data;
        if (sections.length === 0) {
          Alert.alert('Нет участков', 'В этом цехе ещё нет участков');
          return;
        }
        sectionId = await showChoice('Выберите участок', sections.map(s => ({ label: s.name, value: s.id })));
        if (!sectionId) return;
      } else if (getRoleScope(currentUser.role) === 'workshop') {
        const secRes = await orgApi.getSections();
        const sections = secRes.data;
        if (sections.length === 0) {
          Alert.alert('Нет участков', 'Сначала создайте участок в разделе "Цеха и участки"');
          return;
        }
        sectionId = await showChoice('Выберите участок', sections.map(s => ({ label: s.name, value: s.id })));
        if (!sectionId) return;
        workshopId = currentUser.workshop_id;
      } else {
        // Начальник участка / мастер / помощник мастера могут назначать только
        // в собственный участок - выбор здесь не нужен.
        sectionId = currentUser.section_id;
        workshopId = currentUser.workshop_id;
      }
    }

    setPendingRole(role);
    setPendingWorkshopId(workshopId);
    setPendingSectionId(sectionId);
    setSearchQuery('');
    setSearchResults([]);
    setFormVisible(true);
    // Сразу показываем всех доступных пользователей системы, не дожидаясь,
    // пока владелец наберёт поисковый запрос - иначе список выглядит так,
    // будто назначать роль попросту некому.
    runUserSearch('');
  };

  // Ищем среди уже зарегистрированных пользователей системы, чтобы назначить
  // роль одному из них, а не регистрировать нового (см. GET /users/?search=).
  // Пустой запрос возвращает всех активных пользователей (GET /users/ без
  // параметра search отдаёт полный список).
  const runUserSearch = async (query = searchQuery) => {
    setSearching(true);
    try {
      const res = await usersApi.getUsers(query.trim() || undefined);
      setSearchResults((res.data || []).filter(u => u.id !== currentUser?.id));
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось выполнить поиск пользователей');
    } finally {
      setSearching(false);
    }
  };

  const assignExistingUser = (user) => {
    Alert.alert(
      'Назначить роль',
      `Назначить ${formatName(user)} роль «${ROLE_LABELS_RU[pendingRole] || pendingRole}»?`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Назначить',
          onPress: async () => {
            setAssigningUserId(user.id);
            try {
              await orgApi.assignEmployee({
                user_id: user.id,
                role: pendingRole,
                workshop_id: pendingWorkshopId,
                section_id: pendingSectionId,
              });
              setFormVisible(false);
              fetchEmployees();
            } catch (err) {
              Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось назначить роль');
            } finally {
              setAssigningUserId(null);
            }
          },
        },
      ]
    );
  };

  // --- Действия с существующим сотрудником ---

  const changeRole = async (employee) => {
    let roles;
    try {
      const rolesRes = await orgApi.getAssignableRoles();
      roles = rolesRes.data;
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось получить список доступных ролей');
      return;
    }
    const role = await showChoice('Сменить роль', roles.map(r => ({ label: r.label, value: r.value })), `Текущая роль: ${getRoleLabel(employee.role)}`);
    if (!role) return;
    try {
      await orgApi.updateEmployeeRole(employee.id, role);
      fetchEmployees();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось изменить роль');
    }
  };

  const reassignEmployee = async (employee) => {
    let workshopId = employee.workshop_id;
    let sectionId = null;

    if (getRoleScope(currentUser.role) === 'global') {
      const wsRes = await orgApi.getWorkshops();
      const workshops = wsRes.data;
      if (workshops.length === 0) {
        Alert.alert('Нет цехов', 'Сначала создайте цех в разделе "Цеха и участки"');
        return;
      }
      workshopId = await showChoice('Выберите цех', workshops.map(w => ({ label: w.name, value: w.id })));
      if (!workshopId) return;
    } else {
      workshopId = currentUser.workshop_id;
    }

    const secRes = await orgApi.getSections(workshopId);
    const sections = secRes.data;
    if (sections.length > 0) {
      sectionId = await showChoice('Выберите участок', sections.map(s => ({ label: s.name, value: s.id })));
      if (!sectionId) return;
    }

    try {
      await orgApi.updateEmployeeAssignment(employee.id, { workshop_id: workshopId, section_id: sectionId });
      fetchEmployees();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось назначить цех/участок');
    }
  };

  const moveWorker = async (employee) => {
    const secRes = await orgApi.getSections();
    const sections = (secRes.data || []).filter(s => s.id !== employee.section_id);
    if (sections.length === 0) {
      Alert.alert('Нет доступных участков', 'Нет других участков для перемещения');
      return;
    }
    const sectionId = await showChoice('Переместить на участок', sections.map(s => ({ label: s.name, value: s.id })));
    if (!sectionId) return;
    try {
      await orgApi.moveWorker(employee.id, sectionId);
      fetchEmployees();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось переместить рабочего');
    }
  };

  const deleteEmployee = (employee) => {
    Alert.alert(
      'Удаление сотрудника',
      `Удалить ${formatName(employee)}?`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            try {
              await orgApi.deleteEmployee(employee.id);
              fetchEmployees();
            } catch (err) {
              Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось удалить сотрудника');
            }
          },
        },
      ]
    );
  };

  const openActions = (employee) => {
    if (employee.id === currentUser.id) return;
    const actions = [
      { text: 'Сменить роль', onPress: () => changeRole(employee) },
      { text: 'Назначить в цех/участок', onPress: () => reassignEmployee(employee) },
    ];
    if (getRoleScope(employee.role) === 'self' && (getRoleScope(currentUser.role) === 'global' || getRoleScope(currentUser.role) === 'workshop')) {
      actions.push({ text: 'Переместить на другой участок', onPress: () => moveWorker(employee) });
    }
    actions.push({ text: 'Удалить', style: 'destructive', onPress: () => deleteEmployee(employee) });
    actions.push({ text: 'Отмена', style: 'cancel' });
    Alert.alert(formatName(employee), getRoleLabel(employee.role), actions);
  };

  const renderEmployee = ({ item }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => openActions(item)}
    >
      <View style={styles.cardInfo}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{formatName(item)}</Text>
        <Text style={[styles.cardSubtitle, { color: colors.primary }]}>{getRoleLabel(item.role)}</Text>
      </View>
      {item.id !== currentUser?.id && (
        <Icon name="ellipsis-vertical" size={20} color={colors.textSecondary} />
      )}
    </TouchableOpacity>
  );

  if (loading && employees.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={employees}
        keyExtractor={item => item.id.toString()}
        renderItem={renderEmployee}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={fetchEmployees}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Сотрудников не найдено</Text>
        }
      />

      <TouchableOpacity style={[styles.fab, { backgroundColor: colors.primary }]} onPress={startCreateEmployee}>
        <Icon name="person-add" size={26} color="#fff" />
      </TouchableOpacity>

      <Modal visible={formVisible} transparent animationType="slide" onRequestClose={() => setFormVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setFormVisible(false)}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior="padding" style={{ width: '100%', alignItems: 'center' }}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                  <View style={styles.modalHeader}>
                    <Text style={[styles.modalTitle, { color: colors.text }]}>
                      Назначить роль: {ROLE_LABELS_RU[pendingRole] || pendingRole}
                    </Text>
                    <TouchableOpacity onPress={() => setFormVisible(false)}>
                      <Icon name="close" size={24} color={colors.text} />
                    </TouchableOpacity>
                  </View>

                  <Text style={[styles.label, { color: colors.text }]}>Найдите пользователя по имени, email или телефону</Text>
                  <View style={styles.searchRow}>
                    <TextInput
                      style={[styles.input, styles.searchInput, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      placeholder="Имя, email или телефон"
                      placeholderTextColor={colors.textSecondary}
                      autoCapitalize="none"
                      autoFocus
                      onSubmitEditing={() => runUserSearch(searchQuery)}
                      returnKeyType="search"
                    />
                    <TouchableOpacity
                      style={[styles.searchButton, { backgroundColor: colors.primary }]}
                      onPress={() => runUserSearch(searchQuery)}
                      disabled={searching}
                    >
                      {searching ? <ActivityIndicator color="#fff" /> : <Icon name="search" size={20} color="#fff" />}
                    </TouchableOpacity>
                  </View>

                  <FlatList
                    data={searchResults}
                    keyExtractor={item => item.id.toString()}
                    style={styles.searchResultsList}
                    keyboardShouldPersistTaps="handled"
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={[styles.userResultRow, { borderColor: colors.border }]}
                        onPress={() => assignExistingUser(item)}
                        disabled={assigningUserId === item.id}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.cardTitle, { color: colors.text }]}>{formatName(item)}</Text>
                          <Text style={[styles.cardSubtitle, { color: colors.textSecondary, fontWeight: 'normal' }]}>
                            {item.email || item.phone_number || ''}
                          </Text>
                        </View>
                        {assigningUserId === item.id ? (
                          <ActivityIndicator color={colors.primary} />
                        ) : (
                          <Icon name="checkmark-circle-outline" size={22} color={colors.primary} />
                        )}
                      </TouchableOpacity>
                    )}
                    ListEmptyComponent={
                      <Text style={[styles.emptyText, { color: colors.textSecondary, marginTop: 20 }]}>
                        {searching ? 'Поиск...' : 'Пользователи не найдены'}
                      </Text>
                    }
                  />
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

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
  cardSubtitle: { fontSize: 12, fontWeight: 'bold', marginTop: 4 },
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
  modalContent: { width: '100%', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, height: '80%' },
  pickerContent: { width: '100%', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '70%' },
  pickerList: { flexGrow: 0 },
  pickerRow: { paddingVertical: 14, borderBottomWidth: 1 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  modalTitle: { fontSize: 16, fontWeight: 'bold', flex: 1, marginRight: 10 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 15 },
  saveButton: { marginTop: 20, padding: 14, borderRadius: 10, alignItems: 'center' },
  saveButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  searchRow: { flexDirection: 'row', alignItems: 'center' },
  searchInput: { flex: 1, marginRight: 8 },
  searchButton: { width: 48, height: 48, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  searchResultsList: { marginTop: 15, flex: 1 },
  userResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
});
