import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { usersApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { API_BASE_URL } from '../constants';
import { formatStatus, formatName } from '../utils/formatters';

export default function UsersScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [currentUserId, setCurrentUserId] = useState(null);

  useEffect(() => {
    usersApi.getMe().then(res => setCurrentUserId(res.data.id)).catch(err => console.log(err));
  }, []);

  useEffect(() => {
    usersApi.getUsers(search)
      .then(res => {
        if (currentUserId) {
          setUsers(res.data.filter(u => u.id !== currentUserId));
        } else {
          setUsers(res.data);
        }
      })
      .catch(err => console.log(err));
  }, [search, currentUserId]);

  const getAvatarUrl = (url) => {
    if (!url) return 'https://via.placeholder.com/150';
    if (url.startsWith('http')) return url;
    return `${API_BASE_URL}${url}`;
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <TextInput
        style={[styles.searchInput, { 
          backgroundColor: colors.surface, 
          color: colors.text, 
          borderColor: colors.border,
          borderWidth: 1 
        }]}
        placeholder="Поиск пользователей..."
        placeholderTextColor={colors.textSecondary}
        value={search}
        onChangeText={setSearch}
      />
      <FlatList
        data={users}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity 
            style={[styles.userItem, { borderBottomColor: colors.border }]}
            onPress={() => navigation.navigate('UserProfile', { userId: item.id })}
          >
            <View style={styles.avatarContainer}>
              <Image 
                source={{ uri: getAvatarUrl(item.avatar_preview_url || item.avatar_url) }} 
                style={styles.avatar} 
              />
              {item.status === 'online' && (
                <View style={[styles.onlineBadge, { backgroundColor: '#4CAF50', borderColor: colors.background }]} />
              )}
            </View>
            <View style={styles.userInfo}>
              <Text style={[styles.userName, { color: colors.text }]}>{formatName(item)}</Text>
              <View style={styles.roleStatus}>
                <Text style={[styles.userRole, { color: colors.textSecondary }]}>{item.role}</Text>
                <Text style={[styles.statusText, { color: colors.textSecondary }]}> • {formatStatus(item.status, item.last_seen)}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 10 },
  searchInput: { height: 40, borderLineWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, marginBottom: 10 },
  userItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', alignItems: 'center' },
  avatarContainer: { position: 'relative' },
  avatar: { width: 50, height: 50, borderRadius: 25, marginRight: 15 },
  onlineBadge: { 
    position: 'absolute', 
    right: 15, 
    bottom: 0, 
    width: 14, 
    height: 14, 
    borderRadius: 7, 
    borderWidth: 2,
    zIndex: 1
  },
  userInfo: { flex: 1 },
  userName: { fontSize: 16, fontWeight: '500' },
  roleStatus: { flexDirection: 'row', alignItems: 'center' },
  userRole: { fontSize: 12, color: 'gray' },
  statusText: { fontSize: 12, color: 'gray' },
});
