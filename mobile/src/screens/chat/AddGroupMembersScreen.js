import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image,
  StyleSheet, ActivityIndicator, Alert
} from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { groupChatApi } from '../../api';
import { useTheme } from '../../context/ThemeContext';
import { theme as themeConstants } from '../../constants/theme';
import { formatName, getAvatarUrl } from '../../utils/formatters';

// Экран выбора друзей для добавления в уже существующую группу (владелец/админ).
export default function AddGroupMembersScreen({ route, navigation }) {
  const { groupId, candidates } = route.params;
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const [selectedIds, setSelectedIds] = useState([]);
  const [saving, setSaving] = useState(false);

  const toggleSelect = useCallback((userId) => {
    setSelectedIds(prev => (
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    ));
  }, []);

  const handleAdd = async () => {
    if (selectedIds.length === 0) {
      Alert.alert('Ошибка', 'Выберите хотя бы одного участника');
      return;
    }
    setSaving(true);
    try {
      await groupChatApi.addMembers(groupId, selectedIds);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Ошибка', e?.response?.data?.detail || 'Не удалось добавить участников');
    } finally {
      setSaving(false);
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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Добавить участников {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
        </Text>
        <TouchableOpacity onPress={handleAdd} disabled={saving} style={styles.headerButton}>
          {saving ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Icon name="checkmark" size={26} color={colors.primary} />
          )}
        </TouchableOpacity>
      </View>
      <FlatList
        data={candidates}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerButton: { padding: 6 },
  headerTitle: { fontSize: 16, fontWeight: '600', flex: 1 },
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
