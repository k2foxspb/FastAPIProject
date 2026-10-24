import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { documentsApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function MyDocumentsScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAssignments = useCallback(async () => {
    try {
      const res = await documentsApi.getMyDocuments();
      setAssignments(res.data || []);
    } catch (err) {
      console.log('[MyDocumentsScreen] load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadAssignments(); }, [loadAssignments]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAssignments();
    setRefreshing(false);
  };

  const renderItem = ({ item }) => {
    const confirmed = item.status === 'confirmed';
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('DocumentView', { documentId: item.document_id })}
      >
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{item.document_title}</Text>
          <View style={[styles.statusBadge, { backgroundColor: confirmed ? '#43a04720' : '#f59e0b20' }]}>
            <Icon name={confirmed ? 'checkmark-circle' : 'time-outline'} size={14} color={confirmed ? '#43a047' : '#f59e0b'} />
            <Text style={[styles.statusText, { color: confirmed ? '#43a047' : '#f59e0b' }]}>
              {confirmed ? 'Ознакомлен' : 'Ожидает'}
            </Text>
          </View>
        </View>
        {!!item.category_title && (
          <Text style={[styles.cardCategory, { color: colors.textSecondary }]}>{item.category_title}</Text>
        )}
        {!!item.document_description && (
          <Text style={[styles.cardDescription, { color: colors.textSecondary }]} numberOfLines={2}>
            {item.document_description}
          </Text>
        )}
        <Text style={[styles.cardDate, { color: colors.textSecondary }]}>
          Назначено: {new Date(item.assigned_at).toLocaleDateString('ru-RU')}
          {confirmed && item.confirmed_at ? ` • Ознакомлен: ${new Date(item.confirmed_at).toLocaleDateString('ru-RU')}` : ''}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={assignments}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="document-text-outline" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                Вам пока не назначены документы для ознакомления
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 16, fontWeight: 'bold', flex: 1, marginRight: 8 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 11, fontWeight: 'bold', marginLeft: 4 },
  cardCategory: { fontSize: 12, marginTop: 4 },
  cardDescription: { fontSize: 13, marginTop: 6 },
  cardDate: { fontSize: 12, marginTop: 8 },
  emptyContainer: { alignItems: 'center', marginTop: 60, paddingHorizontal: 30 },
  emptyText: { marginTop: 12, fontSize: 15, textAlign: 'center' },
});
