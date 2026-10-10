import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ActivityIndicator, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { orgApi } from '../api';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { formatName, getAvatarUrl } from '../utils/formatters';
import { getRoleLabel } from '../constants/roles';

export default function UserHierarchyScreen({ route, navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { userId, userName } = route.params || {};

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchHierarchy = useCallback(async () => {
    try {
      setLoading(true);
      const res = await orgApi.getEmployeeHierarchy(userId);
      setData(res.data);
      setError(null);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(detail || 'Не удалось загрузить иерархию пользователя');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      fetchHierarchy();
    }, [fetchHierarchy])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchHierarchy();
    setRefreshing(false);
  }, [fetchHierarchy]);

  const openEmployee = (employee) => {
    if (employee.id === userId) return;
    navigation.push('UserProfile', { userId: employee.id });
  };

  const renderEmployee = (employee) => (
    <TouchableOpacity
      key={employee.id}
      style={[styles.employeeRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => openEmployee(employee)}
    >
      <Image source={{ uri: getAvatarUrl(employee.avatar_url) }} style={styles.avatar} />
      <View style={styles.employeeInfo}>
        <Text style={[styles.employeeName, { color: colors.text }]}>{formatName(employee)}</Text>
        <Text style={[styles.employeeRole, { color: colors.textSecondary }]}>{getRoleLabel(employee.role)}</Text>
      </View>
      <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  const renderSection = (title, iconName, items, emptyText) => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Icon name={iconName} size={18} color={colors.primary} />
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      </View>
      {items.length > 0 ? (
        items.map(renderEmployee)
      ) : (
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{emptyText}</Text>
      )}
    </View>
  );

  if (loading && !data) return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );

  if (error && !data) return (
    <View style={[styles.center, { backgroundColor: colors.background, padding: 20 }]}>
      <Icon name="alert-circle-outline" size={48} color={colors.error} />
      <Text style={[styles.errorText, { color: colors.text }]}>{error}</Text>
      <TouchableOpacity style={[styles.retryBtn, { backgroundColor: colors.primary }]} onPress={fetchHierarchy}>
        <Text style={styles.retryText}>Повторить</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Image source={{ uri: getAvatarUrl(data.user.avatar_url) }} style={styles.headerAvatar} />
        <Text style={[styles.headerName, { color: colors.text }]}>{formatName(data.user) || userName}</Text>
        <Text style={[styles.headerRole, { color: colors.textSecondary }]}>{getRoleLabel(data.user.role)}</Text>
      </View>

      {renderSection('Начальники', 'arrow-up-circle-outline', data.superiors, 'Нет вышестоящих руководителей')}
      {renderSection('Подчинённые', 'arrow-down-circle-outline', data.subordinates, 'Нет подчинённых сотрудников')}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { alignItems: 'center', padding: 20, borderBottomWidth: 1 },
  headerAvatar: { width: 70, height: 70, borderRadius: 35, marginBottom: 10 },
  headerName: { fontSize: 18, fontWeight: 'bold' },
  headerRole: { fontSize: 13, marginTop: 2 },
  section: { padding: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginLeft: 8 },
  employeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10 },
  employeeInfo: { flex: 1 },
  employeeName: { fontSize: 15, fontWeight: '600' },
  employeeRole: { fontSize: 12, marginTop: 2 },
  emptyText: { fontStyle: 'italic' },
  errorText: { textAlign: 'center', marginTop: 10, marginBottom: 15 },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: '600' },
});
