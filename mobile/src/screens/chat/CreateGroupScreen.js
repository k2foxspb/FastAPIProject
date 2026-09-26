import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, Image,
  StyleSheet, ActivityIndicator, Alert
} from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usersApi, groupChatApi } from '../../api';
import { useTheme } from '../../context/ThemeContext';
import { theme as themeConstants } from '../../constants/theme';
import { formatName, getAvatarUrl } from '../../utils/formatters';

// Экран создания группового чата: ввод названия и выбор участников из списка друзей.
// Создатель группы автоматически становится владельцем (owner).
export default function CreateGroupScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [friends, setFriends] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await usersApi.getFriendsList();
        setFriends(res.data || []);
      } catch (e) {
        console.error('[CreateGroupScreen] Failed to load friends:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleSelect = useCallback((userId) => {
    setSelectedIds(prev => (
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    ));
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Ошибка', 'Введите название группы');
      return;
    }
    if (selectedIds.length === 0) {
      Alert.alert('Ошибка', 'Выберите хотя бы одного участника');
      return;
    }
    setCreating(true);
    try {
      const res = await groupChatApi.createGroup(name.trim(), selectedIds);
      const group = res.data;
      navigation.replace('GroupChat', { groupId: group.id, groupName: group.name });
    } catch (e) {
      console.error('[CreateGroupScreen] Failed to create group:', e);
      Alert.alert('Ошибка', 'Не удалось создать группу. Попробуйте еще раз.');
    } finally {
      setCreating(false);
    }
  };

  const renderItem = ({ item }) => {
    const isSelected = selectedIds.includes(item.id);
    return (
      <TouchableOpacity
        style={[styles.userRow, { borderBottomColor: colors.border }]}
        onPress={() => toggleSelect(item.id)}
        activeOpacity={0.7}
      >
        <Image source={{ uri: getAvatarUrl(item.avatar_url) }} style={styles.avatar} />
        <Text style={[styles.userName, { color: colors.text }]}>{formatName(item)}</Text>
        <View style={[
          styles.checkbox,
          { borderColor: colors.primary },
          isSelected && { backgroundColor: colors.primary }
        ]}>
          {isSelected && <Icon name="checkmark" size={16} color="#fff" />}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Icon name="close" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Новая группа</Text>
        <TouchableOpacity onPress={handleCreate} disabled={creating} style={styles.headerButton}>
          {creating ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Icon name="checkmark" size={26} color={colors.primary} />
          )}
        </TouchableOpacity>
      </View>

      <TextInput
        style={[styles.nameInput, { color: colors.text, borderBottomColor: colors.border }]}
        placeholder="Название группы"
        placeholderTextColor={colors.textSecondary}
        value={name}
        onChangeText={setName}
        maxLength={100}
      />

      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
        Участники {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
      </Text>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />
      ) : friends.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          У вас пока нет друзей, которых можно добавить в группу.
        </Text>
      ) : (
        <FlatList
          data={friends}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerButton: { padding: 6 },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  nameInput: {
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  emptyText: { textAlign: 'center', marginTop: 30, paddingHorizontal: 20 },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  userName: { flex: 1, fontSize: 15, fontWeight: '500' },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
