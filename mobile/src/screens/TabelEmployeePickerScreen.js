import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { orgApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { useNotifications } from '../context/NotificationContext';
import { formatName } from '../utils/formatters';
import { getRoleLabel, getRoleIcon } from '../constants/roles';

// Список сотрудников, видимых текущему пользователю по иерархии должностей
// (см. GET /org/employees), для выбора, чей табель/продукцию открыть.
export default function TabelEmployeePickerScreen({ navigation, route }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser } = useNotifications();
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const onSelect = route.params?.onSelect;

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      orgApi.getEmployees()
        .then(res => { if (active) setEmployees(res.data); })
        .catch(() => {})
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [])
  );

  const filtered = employees.filter(e => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return formatName(e).toLowerCase().includes(q) || getRoleLabel(e.role).toLowerCase().includes(q);
  });

  const handlePick = (employee) => {
    if (onSelect) onSelect(employee);
    navigation.goBack();
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <TextInput
        style={[styles.searchInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
        placeholder="Поиск сотрудника..."
        placeholderTextColor={colors.textSecondary}
        value={search}
        onChangeText={setSearch}
      />
      <FlatList
        data={filtered}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.item, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => handlePick(item)}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.background }]}>
              <Icon name={getRoleIcon(item.role)} size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.text }]}>
                {formatName(item)}{item.id === currentUser?.id ? ' (Я)' : ''}
              </Text>
              <Text style={[styles.role, { color: colors.textSecondary }]}>{getRoleLabel(item.role)}</Text>
            </View>
            <Icon name="chevron-forward" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Сотрудники не найдены</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  searchInput: { height: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, margin: 15, marginBottom: 5 },
  list: { padding: 15, paddingTop: 5 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  name: { fontSize: 15, fontWeight: '600' },
  role: { fontSize: 13, marginTop: 2 },
  emptyText: { textAlign: 'center', marginTop: 40, fontSize: 15 },
});
