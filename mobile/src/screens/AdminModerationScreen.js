import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { adminApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { Ionicons as Icon } from '@expo/vector-icons';

export default function AdminModerationScreen() {
  const [pending, setPending] = useState({ products: [], news: [] });
  const [loading, setLoading] = useState(true);
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const loadPending = async () => {
    try {
      setLoading(true);
      const res = await adminApi.getPendingModeration();
      setPending(res.data);
    } catch (err) {
      console.error(err);
      Alert.alert('Ошибка', 'Не удалось загрузить список на модерацию');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPending();
  }, []);

  const handleApprove = async (model, id) => {
    try {
      await adminApi.approveObject(model, id);
      loadPending();
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось одобрить');
    }
  };

  const handleReject = async (model, id) => {
    try {
      await adminApi.rejectObject(model, id);
      loadPending();
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось отклонить');
    }
  };

  const renderItem = ({ item, type }) => {
    const createdAt = new Date(item.created_at);
    const now = new Date();
    const diffMinutes = Math.floor((now - createdAt) / 60000);
    const isUrgent = diffMinutes >= 5;

    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: isUrgent ? colors.error : colors.border }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
            {item.name || item.title}
          </Text>
          {isUrgent && (
            <View style={[styles.urgentBadge, { backgroundColor: colors.error }]}>
              <Text style={styles.urgentText}>{diffMinutes} мин</Text>
            </View>
          )}
        </View>
        <Text style={[styles.cardType, { color: colors.textSecondary }]}>
          {type === 'product' ? 'Товар' : 'Новость'} • {createdAt.toLocaleTimeString()}
        </Text>
        <View style={styles.actions}>
          <TouchableOpacity 
            style={[styles.actionButton, { backgroundColor: colors.primary }]}
            onPress={() => handleApprove(type, item.id)}
          >
            <Icon name="checkmark" size={20} color="#fff" />
            <Text style={styles.actionText}>Одобрить</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.actionButton, { backgroundColor: colors.error }]}
            onPress={() => handleReject(type, item.id)}
          >
            <Icon name="close" size={20} color="#fff" />
            <Text style={styles.actionText}>Отклонить</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const allPending = [
    ...pending.products.map(p => ({ ...p, _type: 'product' })),
    ...pending.news.map(n => ({ ...n, _type: 'news' }))
  ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={allPending}
        keyExtractor={(item) => `${item._type}-${item.id}`}
        renderItem={({ item }) => renderItem({ item, type: item._type })}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={loadPending}
        ListEmptyComponent={
          !loading && <Text style={[styles.empty, { color: colors.textSecondary }]}>Нет объектов на модерацию</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 15 },
  card: {
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
    borderWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', flex: 1 },
  cardType: { fontSize: 14, marginBottom: 15 },
  urgentBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginLeft: 10 },
  urgentText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 10,
  },
  actionText: { color: '#fff', fontWeight: 'bold', marginLeft: 5 },
  empty: { textAlign: 'center', marginTop: 50, fontSize: 16 },
});
