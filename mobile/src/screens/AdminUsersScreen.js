import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Modal, TextInput, TouchableWithoutFeedback } from 'react-native';
import api, { adminApi } from '../api';
import { Ionicons as Icon, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { getRoleLabel, getRoleIcon, getRoleColor, canManageRoles } from '../constants/roles';
import { useNotifications } from '../context/NotificationContext';

// Варианты срока блокировки: null означает "навсегда"
const BAN_DURATION_OPTIONS = [
  { value: 1, label: '1 час' },
  { value: 24, label: '24 часа' },
  { value: 24 * 7, label: '7 дней' },
  { value: 24 * 30, label: '30 дней' },
  { value: null, label: 'Навсегда' },
];

const formatBannedUntil = (bannedUntil) => {
  if (!bannedUntil) return 'навсегда';
  try {
    return new Date(bannedUntil).toLocaleString('ru-RU');
  } catch {
    return bannedUntil;
  }
};

export default function AdminUsersScreen({ navigation }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser } = useNotifications();
  // Назначать/снимать роль "admin" может только владелец (см. app/core/roles.py) -
  // администратор элементы управления ролями не видит вообще.
  const canEditRoles = canManageRoles(currentUser?.role);

  const [banModalVisible, setBanModalVisible] = useState(false);
  const [banTargetUser, setBanTargetUser] = useState(null);
  const [banReason, setBanReason] = useState('');
  const [banDuration, setBanDuration] = useState(BAN_DURATION_OPTIONS[0].value);
  const [banSubmitting, setBanSubmitting] = useState(false);

  const fetchUsers = async () => {
    try {
      const res = await api.get('/admin/users');
      setUsers(res.data);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить пользователей');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Ролей всего три: owner/admin/user. Роль "owner" назначить/снять нельзя -
  // владелец может переключать только "admin" <-> "user".
  const USER_ROLE_OPTIONS = [
    { value: 'user', label: 'Пользователь' },
    { value: 'admin', label: 'Администратор' },
  ];

  const changeRole = (userId, currentRole) => {
    if (currentRole === 'owner') return;
    Alert.alert(
      'Сменить роль',
      `Текущая роль: ${getRoleLabel(currentRole)}`,
      USER_ROLE_OPTIONS.map(({ value, label }) => ({
        text: label,
        onPress: async () => {
          try {
            await api.patch(`/admin/users/${userId}/role?role=${value}`);
            fetchUsers();
          } catch (err) {
            Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось обновить роль');
          }
        }
      })),
      { cancelable: true }
    );
  };

  const openBanModal = (user) => {
    setBanTargetUser(user);
    setBanReason('');
    setBanDuration(BAN_DURATION_OPTIONS[0].value);
    setBanModalVisible(true);
  };

  const closeBanModal = () => {
    if (banSubmitting) return;
    setBanModalVisible(false);
    setBanTargetUser(null);
  };

  const confirmBan = async () => {
    if (!banTargetUser) return;
    setBanSubmitting(true);
    try {
      await adminApi.banUser(banTargetUser.id, { reason: banReason.trim() || null, durationHours: banDuration });
      setBanModalVisible(false);
      setBanTargetUser(null);
      fetchUsers();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось заблокировать пользователя');
    } finally {
      setBanSubmitting(false);
    }
  };

  const unbanUser = (user) => {
    Alert.alert(
      'Разблокировать пользователя',
      `Снять блокировку с ${user.email}?`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Разблокировать',
          onPress: async () => {
            try {
              await adminApi.unbanUser(user.id);
              fetchUsers();
            } catch (err) {
              Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось разблокировать пользователя');
            }
          }
        }
      ],
      { cancelable: true }
    );
  };

  const renderUser = ({ item }) => (
    <TouchableOpacity 
      style={[styles.userCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => navigation.navigate('UserProfile', { userId: item.id, isAdminView: true })}
    >
      <View style={styles.userInfo}>
        <MaterialCommunityIcons name={getRoleIcon(item.role)} size={20} color={getRoleColor(item.role)} style={styles.roleIcon} />
        <View>
          <Text style={[styles.userEmail, { color: colors.text }]}>{item.email}</Text>
          <Text style={[styles.userRole, { color: colors.primary }]}>{getRoleLabel(item.role)}</Text>
          {item.is_banned && (
            <View style={styles.banBadge}>
              <Icon name="ban-outline" size={12} color="#fff" style={{ marginRight: 4 }} />
              <Text style={styles.banBadgeText}>
                Заблокирован {item.banned_until ? `до ${formatBannedUntil(item.banned_until)}` : '(навсегда)'}
              </Text>
            </View>
          )}
        </View>
      </View>
      <View style={styles.actions}>
        {canEditRoles && item.role !== 'owner' && (
          <TouchableOpacity 
            style={[styles.roleButton, { backgroundColor: colors.primary }]}
            onPress={() => changeRole(item.id, item.role)}
          >
            <Text style={styles.roleButtonText}>Роль</Text>
          </TouchableOpacity>
        )}
        {item.role !== 'owner' && (
          item.is_banned ? (
            <TouchableOpacity 
              style={[styles.roleButton, styles.unbanButton]}
              onPress={() => unbanUser(item)}
            >
              <Text style={styles.roleButtonText}>Разблокировать</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              style={[styles.roleButton, styles.banButton]}
              onPress={() => openBanModal(item)}
            >
              <Text style={styles.roleButtonText}>Заблокировать</Text>
            </TouchableOpacity>
          )
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={users}
        keyExtractor={item => item.id.toString()}
        renderItem={renderUser}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={fetchUsers}
      />

      <Modal
        visible={banModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={closeBanModal}
      >
        <TouchableWithoutFeedback onPress={closeBanModal}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>
                    Заблокировать {banTargetUser?.email}
                  </Text>
                  <TouchableOpacity onPress={closeBanModal}>
                    <Icon name="close" size={24} color={colors.text} />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Причина (необязательно)</Text>
                <TextInput
                  style={[styles.reasonInput, { color: colors.text, borderColor: colors.border }]}
                  placeholder="Укажите причину блокировки"
                  placeholderTextColor={colors.textSecondary}
                  value={banReason}
                  onChangeText={setBanReason}
                  multiline
                />

                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Срок блокировки</Text>
                <View style={styles.durationOptions}>
                  {BAN_DURATION_OPTIONS.map(({ value, label }) => (
                    <TouchableOpacity
                      key={label}
                      style={[
                        styles.durationOption,
                        { borderColor: colors.border },
                        banDuration === value && { backgroundColor: colors.primary, borderColor: colors.primary }
                      ]}
                      onPress={() => setBanDuration(value)}
                    >
                      <Text style={[
                        styles.durationOptionText,
                        { color: banDuration === value ? '#fff' : colors.text }
                      ]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity
                  style={[styles.confirmButton, { backgroundColor: colors.primary, opacity: banSubmitting ? 0.6 : 1 }]}
                  onPress={confirmBan}
                  disabled={banSubmitting}
                >
                  <Text style={styles.confirmButtonText}>
                    {banSubmitting ? 'Блокировка...' : 'Заблокировать'}
                  </Text>
                </TouchableOpacity>
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
  list: { padding: 15 },
  userCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
  },
  userInfo: { flexDirection: 'row', alignItems: 'center' },
  roleIcon: { marginRight: 10 },
  userEmail: { fontSize: 16, fontWeight: '500' },
  userRole: { fontSize: 12, fontWeight: 'bold', marginTop: 4 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  roleButton: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 5, marginLeft: 8 },
  roleButtonText: { color: '#fff', fontWeight: 'bold' },
  banButton: { backgroundColor: '#d9534f' },
  unbanButton: { backgroundColor: '#5cb85c' },
  banBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#d9534f',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  banBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    borderRadius: 15,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  modalTitle: { fontSize: 17, fontWeight: 'bold', flex: 1, marginRight: 10 },
  fieldLabel: { fontSize: 13, fontWeight: '500', marginBottom: 6, marginTop: 10 },
  reasonInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  durationOptions: { flexDirection: 'row', flexWrap: 'wrap' },
  durationOption: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  durationOptionText: { fontSize: 13, fontWeight: '500' },
  confirmButton: {
    marginTop: 15,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
});
