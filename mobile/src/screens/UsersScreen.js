import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { usersApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { useNotifications } from '../context/NotificationContext';
import { theme as themeConstants } from '../constants/theme';
import { API_BASE_URL } from '../constants';
import { formatStatus, formatName } from '../utils/formatters';

export default function UsersScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { fetchFriendRequestsCount, currentUser, loadingUser, userStatuses } = useNotifications();
  const [users, setUsers] = useState([]);
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [search, setSearch] = useState('');
  const [currentUserId, setCurrentUserId] = useState(currentUser?.id);
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'friends'

  // Применяем WebSocket статусы к локальному списку пользователей
  useEffect(() => {
    if (Object.keys(userStatuses).length === 0) return;
    
    console.log('[UsersScreen] Applying userStatuses updates:', Object.keys(userStatuses).length);
    
    setUsers(prev => {
      let changed = false;
      const next = prev.map(u => {
        if (userStatuses[u.id]) {
          const statusChanged = u.status !== userStatuses[u.id].status || u.last_seen !== userStatuses[u.id].last_seen;
          if (statusChanged) {
            changed = true;
            return { ...u, ...userStatuses[u.id] };
          }
        }
        return u;
      });
      return changed ? next : prev;
    });
    
    setFriends(prev => {
      let changed = false;
      const next = prev.map(f => {
        if (userStatuses[f.id]) {
          const statusChanged = f.status !== userStatuses[f.id].status || f.last_seen !== userStatuses[f.id].last_seen;
          if (statusChanged) {
            changed = true;
            return { ...f, ...userStatuses[f.id] };
          }
        }
        return f;
      });
      return changed ? next : prev;
    });
    
    setRequests(prev => {
      let changed = false;
      const next = prev.map(r => {
        if (userStatuses[r.id]) {
          const statusChanged = r.status !== userStatuses[r.id].status || r.last_seen !== userStatuses[r.id].last_seen;
          if (statusChanged) {
            changed = true;
            return { ...r, ...userStatuses[r.id] };
          }
        }
        return r;
      });
      return changed ? next : prev;
    });
  }, [userStatuses]);

  useEffect(() => {
    if (loadingUser) return;
    if (currentUser) {
      setCurrentUserId(currentUser.id);
    }
  }, [currentUser, loadingUser]);

  const fetchData = async () => {
    try {
      if (activeTab === 'all') {
        const res = await usersApi.getUsers(search);
        let data = res.data.filter(u => u.friendship_status !== 'self');
        
        // Сразу применяем статусы из WebSocket, если они есть
        data = data.map(u => userStatuses[u.id] ? { ...u, ...userStatuses[u.id] } : u);
        
        setUsers(data);
      } else {
        const [friendsRes, requestsRes] = await Promise.all([
          usersApi.getFriendsList(),
          usersApi.getFriendRequests()
        ]);
        
        let friendsData = friendsRes.data;
        let requestsData = requestsRes.data;
        
        // Применяем статусы
        friendsData = friendsData.map(f => userStatuses[f.id] ? { ...f, ...userStatuses[f.id] } : f);
        requestsData = requestsData.map(r => userStatuses[r.id] ? { ...r, ...userStatuses[r.id] } : r);
        
        setFriends(friendsData);
        setRequests(requestsData);
      }
    } catch (err) {
      console.log(err);
    }
  };

  useEffect(() => {
    fetchData();
  }, [search, currentUserId, activeTab]);

  const handleAccept = async (userId) => {
    try {
      await usersApi.acceptFriendRequest(userId);
      fetchData();
      fetchFriendRequestsCount(); // Обновляем глобальный счетчик
    } catch (err) {
      console.log(err);
    }
  };

  const handleReject = async (userId) => {
    try {
      await usersApi.rejectFriendRequest(userId);
      fetchData();
      fetchFriendRequestsCount(); // Обновляем глобальный счетчик
    } catch (err) {
      console.log(err);
    }
  };

  const getAvatarUrl = (url) => {
    if (!url) return 'https://via.placeholder.com/150';
    if (url.startsWith('http')) return url;
    return `${API_BASE_URL}${url}`;
  };

  const renderUserItem = ({ item, isRequest = false }) => {
    const getFriendshipText = () => {
      if (item.friendship_status === 'accepted') return ' • Друзья';
      if (item.friendship_status === 'requested_by_me') return ' • Заявка отправлена';
      if (item.friendship_status === 'requested_by_them') return ' • Хочет в друзья';
      return '';
    };

    return (
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
            {item.role !== 'buyer' && (
              <Text style={[styles.userRole, { color: colors.textSecondary }]}>{item.role} • </Text>
            )}
            <Text style={[styles.statusText, { color: colors.textSecondary }]}>{formatStatus(item.status, item.last_seen)}</Text>
            <Text style={[styles.statusText, { color: colors.primary, fontWeight: 'bold' }]}>{getFriendshipText()}</Text>
          </View>
        </View>
        {isRequest && (
          <View style={styles.requestButtons}>
            <TouchableOpacity 
              style={[styles.actionButton, { backgroundColor: '#4CAF50' }]} 
              onPress={() => handleAccept(item.id)}
            >
              <Text style={styles.actionButtonText}>✓</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.actionButton, { backgroundColor: '#F44336' }]} 
              onPress={() => handleReject(item.id)}
            >
              <Text style={styles.actionButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.tabsContainer, { borderBottomColor: colors.border }]}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'friends' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('friends')}
        >
          <Text style={[styles.tabText, { color: activeTab === 'friends' ? colors.primary : colors.textSecondary }]}>
            Друзья {requests.length > 0 ? `(${requests.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'all' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('all')}
        >
          <Text style={[styles.tabText, { color: activeTab === 'all' ? colors.primary : colors.textSecondary }]}>Все пользователи</Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'all' && (
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
      )}

      {activeTab === 'all' ? (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => renderUserItem({ item })}
          ListEmptyComponent={<Text style={[styles.emptyText, { color: colors.textSecondary }]}>Пользователи не найдены</Text>}
        />
      ) : (
        <View style={{ flex: 1 }}>
          {requests.length > 0 && (
            <View>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>ЗАЯВКИ В ДРУЗЬЯ</Text>
              <FlatList
                data={requests}
                keyExtractor={(item) => `req-${item.id}`}
                renderItem={({ item }) => renderUserItem({ item, isRequest: true })}
                scrollEnabled={false}
              />
            </View>
          )}
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, marginTop: 10 }]}>МОИ ДРУЗЬЯ</Text>
          <FlatList
            data={friends}
            keyExtractor={(item) => `friend-${item.id}`}
            renderItem={({ item }) => renderUserItem({ item })}
            ListEmptyComponent={<Text style={[styles.emptyText, { color: colors.textSecondary }]}>У вас пока нет друзей</Text>}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 10 },
  tabsContainer: { flexDirection: 'row', marginBottom: 15, borderBottomWidth: 1, borderBottomColor: '#eee' },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabText: { fontSize: 14, fontWeight: '600' },
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
  requestButtons: { flexDirection: 'row' },
  actionButton: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginLeft: 10 },
  actionButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  sectionTitle: { fontSize: 12, fontWeight: 'bold', marginVertical: 5, paddingHorizontal: 10 },
  emptyText: { textAlign: 'center', marginTop: 20, fontSize: 14 },
});
