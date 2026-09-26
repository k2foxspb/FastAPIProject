import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image,
  StyleSheet, ActivityIndicator, Alert
} from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { groupChatApi, usersApi } from '../../api';
import { useTheme } from '../../context/ThemeContext';
import { useNotifications } from '../../context/NotificationContext';
import { theme as themeConstants } from '../../constants/theme';
import { formatName, getAvatarUrl } from '../../utils/formatters';

const ROLE_LABELS = { owner: 'Владелец', admin: 'Администратор', member: 'Участник' };

// Экран информации о группе: список участников с ролями, добавление/удаление
// участников (владелец и администраторы), назначение/снятие администраторов (только владелец).
export default function GroupInfoScreen({ route, navigation }) {
  const { groupId } = route.params;
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const insets = useSafeAreaInsets();
  const { currentUserId } = useNotifications();

  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchGroup = useCallback(async () => {
    try {
      const res = await groupChatApi.getGroup(groupId);
      setGroup(res.data);
      navigation.setOptions({ title: res.data.name });
    } catch (e) {
      console.error('[GroupInfoScreen] Failed to load group:', e);
      Alert.alert('Ошибка', 'Не удалось загрузить информацию о группе');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useFocusEffect(useCallback(() => { fetchGroup(); }, [fetchGroup]));

  const myRole = group?.my_role;
  const canManage = myRole === 'owner' || myRole === 'admin';
  const isOwner = myRole === 'owner';

  const handleAddMembers = async () => {
    try {
      const res = await usersApi.getFriendsList();
      const friends = res.data || [];
      const existingIds = new Set((group?.members || []).map(m => m.user_id));
      const candidates = friends.filter(f => !existingIds.has(f.id));
      if (candidates.length === 0) {
        Alert.alert('Нет кандидатов', 'Все ваши друзья уже в этой группе');
        return;
      }
      navigation.navigate('AddGroupMembers', { groupId, candidates });
    } catch (e) {
      console.error('[GroupInfoScreen] Failed to load friends for adding:', e);
    }
  };

  const handleRemoveMember = (member) => {
    Alert.alert(
      'Удалить участника',
      `Удалить ${formatName(member)} из группы?`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await groupChatApi.removeMember(groupId, member.user_id);
              setGroup(res.data);
            } catch (e) {
              Alert.alert('Ошибка', e?.response?.data?.detail || 'Не удалось удалить участника');
            }
          }
        }
      ]
    );
  };

  const handlePromote = async (member) => {
    try {
      const res = await groupChatApi.promoteToAdmin(groupId, member.user_id);
      setGroup(res.data);
    } catch (e) {
      Alert.alert('Ошибка', e?.response?.data?.detail || 'Не удалось назначить администратора');
    }
  };

  const handleDemote = async (member) => {
    try {
      const res = await groupChatApi.demoteAdmin(groupId, member.user_id);
      setGroup(res.data);
    } catch (e) {
      Alert.alert('Ошибка', e?.response?.data?.detail || 'Не удалось снять права администратора');
    }
  };

  const handleLeaveOrDelete = () => {
    if (isOwner) {
      Alert.alert(
        'Удалить группу',
        'Вы владелец группы. Удаление группы удалит её для всех участников. Продолжить?',
        [
          { text: 'Отмена', style: 'cancel' },
          {
            text: 'Удалить',
            style: 'destructive',
            onPress: async () => {
              try {
                await groupChatApi.deleteGroup(groupId);
                navigation.navigate('ChatList');
              } catch (e) {
                Alert.alert('Ошибка', 'Не удалось удалить группу');
              }
            }
          }
        ]
      );
    } else {
      Alert.alert(
        'Покинуть группу',
        'Вы уверены, что хотите покинуть эту группу?',
        [
          { text: 'Отмена', style: 'cancel' },
          {
            text: 'Покинуть',
            style: 'destructive',
            onPress: async () => {
              try {
                await groupChatApi.leaveGroup(groupId);
                navigation.navigate('ChatList');
              } catch (e) {
                Alert.alert('Ошибка', e?.response?.data?.detail || 'Не удалось покинуть группу');
              }
            }
          }
        ]
      );
    }
  };

  const renderMember = ({ item }) => {
    const isMe = Number(item.user_id) === Number(currentUserId);
    const canRemove = canManage && item.role !== 'owner' && !(item.role === 'admin' && !isOwner) && !isMe;
    const canPromote = isOwner && item.role === 'member';
    const canDemote = isOwner && item.role === 'admin';

    return (
      <TouchableOpacity
        style={[styles.memberRow, { borderBottomColor: colors.border }]}
        onPress={() => navigation.navigate('UserProfile', { userId: item.user_id })}
        activeOpacity={0.7}
      >
        <Image source={{ uri: getAvatarUrl(item.avatar_url) }} style={styles.avatar} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.memberName, { color: colors.text }]}>
            {formatName(item)}{isMe ? ' (Вы)' : ''}
          </Text>
          <Text style={[styles.memberRole, { color: colors.textSecondary }]}>
            {ROLE_LABELS[item.role] || item.role}
          </Text>
        </View>
        {canPromote && (
          <TouchableOpacity onPress={() => handlePromote(item)} style={styles.actionButton}>
            <Icon name="shield-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
        )}
        {canDemote && (
          <TouchableOpacity onPress={() => handleDemote(item)} style={styles.actionButton}>
            <Icon name="shield-half-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
        {canRemove && (
          <TouchableOpacity onPress={() => handleRemoveMember(item)} style={styles.actionButton}>
            <Icon name="person-remove-outline" size={20} color="#e74c3c" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  if (loading || !group) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.groupHeader}>
        <Text style={[styles.groupName, { color: colors.text }]}>{group.name}</Text>
        <Text style={[styles.membersCount, { color: colors.textSecondary }]}>
          {group.members.length} {group.members.length === 1 ? 'участник' : 'участников'}
        </Text>
      </View>

      {canManage && (
        <TouchableOpacity style={[styles.addButton, { borderBottomColor: colors.border }]} onPress={handleAddMembers}>
          <View style={[styles.addIcon, { backgroundColor: colors.primary }]}>
            <Icon name="person-add" size={18} color="#fff" />
          </View>
          <Text style={[styles.addButtonText, { color: colors.primary }]}>Добавить участников</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={group.members}
        keyExtractor={(item) => item.user_id.toString()}
        renderItem={renderMember}
        contentContainerStyle={{ paddingBottom: insets.bottom + 10 }}
      />

      <TouchableOpacity style={styles.leaveButton} onPress={handleLeaveOrDelete}>
        <Icon name={isOwner ? 'trash-outline' : 'exit-outline'} size={18} color="#e74c3c" />
        <Text style={styles.leaveButtonText}>{isOwner ? 'Удалить группу' : 'Покинуть группу'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  groupHeader: { alignItems: 'center', paddingVertical: 20 },
  groupName: { fontSize: 20, fontWeight: '700' },
  membersCount: { fontSize: 13, marginTop: 4 },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  addIcon: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  addButtonText: { fontSize: 15, fontWeight: '600' },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  memberName: { fontSize: 15, fontWeight: '500' },
  memberRole: { fontSize: 12, marginTop: 2 },
  actionButton: { padding: 8, marginLeft: 4 },
  leaveButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
  },
  leaveButtonText: { color: '#e74c3c', fontSize: 15, fontWeight: '600', marginLeft: 8 },
});
