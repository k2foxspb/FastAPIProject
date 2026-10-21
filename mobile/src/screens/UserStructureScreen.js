import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { orgApi, usersApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { formatName, formatStatus, getAvatarUrl } from '../utils/formatters';
import AvatarWithBadge from '../components/AvatarWithBadge';

// Экран просмотра пользователей по производственной структуре: Цеха -> Участки -> Сотрудники.
// Реализован одним компонентом, который "проваливается" в себя же через
// navigation.push с разными route.params (view/workshopId/sectionId) -
// так заголовок и кнопка "назад" работают стандартно через стек навигации.
export default function UserStructureScreen({ route, navigation }) {
  const { view = 'workshops', workshopId = null, sectionId = null } = route.params || {};
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [workshops, setWorkshops] = useState([]);
  const [sections, setSections] = useState([]);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    try {
      if (view === 'sections') {
        const res = await orgApi.getSections(workshopId);
        setSections(res.data);
      } else if (view === 'users') {
        const res = await usersApi.getUsers(search, workshopId, sectionId);
        setUsers(res.data);
      } else {
        const res = await orgApi.getWorkshops();
        setWorkshops(res.data);
      }
    } catch (err) {
      console.log(err);
    } finally {
      setLoading(false);
    }
  }, [view, workshopId, sectionId, search]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const openWorkshop = (workshop) => {
    navigation.push('UserStructure', { view: 'sections', workshopId: workshop.id, title: workshop.name });
  };

  const openSection = (section) => {
    navigation.push('UserStructure', { view: 'users', workshopId, sectionId: section.id, title: section.name });
  };

  const openAllWorkshopUsers = () => {
    navigation.push('UserStructure', { view: 'users', workshopId, sectionId: null, title: 'Все сотрудники цеха' });
  };

  const renderWorkshop = ({ item }) => (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => openWorkshop(item)}
    >
      <Icon name="business-outline" size={22} color={colors.primary} style={styles.rowIcon} />
      <Text style={[styles.rowText, { color: colors.text }]}>{item.name}</Text>
      <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  const renderSection = ({ item }) => (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => openSection(item)}
    >
      <Icon name="git-network-outline" size={22} color={colors.primary} style={styles.rowIcon} />
      <Text style={[styles.rowText, { color: colors.text }]}>{item.name}</Text>
      <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  const renderUser = ({ item }) => (
    <TouchableOpacity
      style={[styles.userRow, { borderBottomColor: colors.border }]}
      onPress={() => navigation.navigate('UserProfile', { userId: item.id })}
    >
      <AvatarWithBadge
        uri={getAvatarUrl(item.avatar_preview_url || item.avatar_url)}
        role={item.role}
        size={44}
        style={{ marginRight: 12 }}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.userName, { color: colors.text }]}>{formatName(item)}</Text>
        <Text style={[styles.userStatus, { color: colors.textSecondary }]}>{formatStatus(item.status, item.last_seen)}</Text>
      </View>
    </TouchableOpacity>
  );

  if (loading && !refreshing) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (view === 'sections') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <FlatList
          data={sections}
          keyExtractor={(item) => `sec-${item.id}`}
          renderItem={renderSection}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={
            <TouchableOpacity
              style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 12 }]}
              onPress={openAllWorkshopUsers}
            >
              <Icon name="people-outline" size={22} color={colors.primary} style={styles.rowIcon} />
              <Text style={[styles.rowText, { color: colors.text }]}>Все сотрудники цеха</Text>
              <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          }
          ListEmptyComponent={<Text style={[styles.emptyText, { color: colors.textSecondary }]}>Участков пока нет</Text>}
        />
      </View>
    );
  }

  if (view === 'users') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <TextInput
          style={[styles.searchInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          placeholder="Поиск пользователей..."
          placeholderTextColor={colors.textSecondary}
          value={search}
          onChangeText={setSearch}
        />
        <FlatList
          data={users}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderUser}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={<Text style={[styles.emptyText, { color: colors.textSecondary }]}>Пользователи не найдены</Text>}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={workshops}
        keyExtractor={(item) => `ws-${item.id}`}
        renderItem={renderWorkshop}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={[styles.emptyText, { color: colors.textSecondary }]}>Цехов пока нет</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  rowIcon: { marginRight: 12 },
  rowText: { flex: 1, fontSize: 15, fontWeight: '600' },
  searchInput: { height: 40, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, margin: 12, marginBottom: 6 },
  userRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1 },
  userName: { fontSize: 15, fontWeight: '500' },
  userStatus: { fontSize: 12, marginTop: 2 },
  emptyText: { textAlign: 'center', marginTop: 20, fontSize: 14 },
});
