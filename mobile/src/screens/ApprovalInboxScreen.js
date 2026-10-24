import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { documentsApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function ApprovalInboxScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadDocuments = useCallback(async () => {
    try {
      const res = await documentsApi.getApprovalInbox();
      setDocuments(res.data || []);
    } catch (err) {
      console.log('[ApprovalInboxScreen] load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadDocuments(); }, [loadDocuments]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDocuments();
    setRefreshing(false);
  };

  const renderItem = ({ item }) => {
    const authorName = item.author
      ? `${item.author.first_name || ''} ${item.author.last_name || ''}`.trim() || 'Руководитель'
      : 'Руководитель';
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('DocumentApproval', { documentId: item.id })}
      >
        <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
        {!!item.category_title && (
          <Text style={[styles.cardCategory, { color: colors.textSecondary }]}>{item.category_title}</Text>
        )}
        <Text style={[styles.cardAuthor, { color: colors.textSecondary }]}>Автор: {authorName}</Text>
        {item.approval_started_at && (
          <Text style={[styles.cardDate, { color: colors.textSecondary }]}>
            Отправлено на согласование: {new Date(item.approval_started_at).toLocaleDateString('ru-RU')}
          </Text>
        )}
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
          data={documents}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="checkmark-done-circle-outline" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                Нет документов, ожидающих вашего согласования
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
  cardTitle: { fontSize: 16, fontWeight: 'bold' },
  cardCategory: { fontSize: 12, marginTop: 4 },
  cardAuthor: { fontSize: 13, marginTop: 6 },
  cardDate: { fontSize: 12, marginTop: 4 },
  emptyContainer: { alignItems: 'center', marginTop: 60, paddingHorizontal: 30 },
  emptyText: { marginTop: 12, fontSize: 15, textAlign: 'center' },
});
