import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import api from '../api';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { getRoleLabel, getRoleIcon, canManageRoles } from '../constants/roles';
import { useNotifications } from '../context/NotificationContext';

export default function AdminUsersScreen({ navigation }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser } = useNotifications();
  // Назначать/снимать роль "admin" может только владелец (см. app/core/roles.py) -
  // администратор элементы управления ролями не видит вообще.
  const canEditRoles = canManageRoles(currentUser?.role);

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

  const renderUser = ({ item }) => (
    <TouchableOpacity 
      style={[styles.userCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => navigation.navigate('UserProfile', { userId: item.id, isAdminView: true })}
    >
      <View style={styles.userInfo}>
        <Icon name={getRoleIcon(item.role)} size={18} color={colors.primary} style={styles.roleIcon} />
        <View>
          <Text style={[styles.userEmail, { color: colors.text }]}>{item.email}</Text>
          <Text style={[styles.userRole, { color: colors.primary }]}>{getRoleLabel(item.role)}</Text>
        </View>
      </View>
      {canEditRoles && item.role !== 'owner' && (
        <TouchableOpacity 
          style={[styles.roleButton, { backgroundColor: colors.primary }]}
          onPress={() => changeRole(item.id, item.role)}
        >
          <Text style={styles.roleButtonText}>Роль</Text>
        </TouchableOpacity>
      )}
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
  roleButton: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 5 },
  roleButtonText: { color: '#fff', fontWeight: 'bold' },
});
