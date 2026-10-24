import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { documentsApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

const STATUS_INFO = {
  draft: { label: 'Черновик', color: '#9e9e9e' },
  pending_approval: { label: 'На согласовании', color: '#f59e0b' },
  approved: { label: 'Согласован', color: '#1e88e5' },
  rejected: { label: 'Отклонён', color: '#e53935' },
  sent: { label: 'Отправлен', color: '#43a047' },
  archived: { label: 'Архив', color: '#607d8b' },
};

export default function DocumentsListScreen({ navigation, route }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { categoryId, categoryTitle } = route.params || {};

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadDocuments = useCallback(async () => {
    try {
      const res = await documentsApi.getDocuments();
      let list = res.data || [];
      if (categoryId) {
        list = list.filter((d) => d.category_id === categoryId);
      }
      setDocuments(list);
    } catch (err) {
      console.log('[DocumentsListScreen] load error:', err);
    } finally {
      setLoading(false);
    }
  }, [categoryId]);

  useFocusEffect(useCallback(() => { loadDocuments(); }, [loadDocuments]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDocuments();
    setRefreshing(false);
  };

  const handleDelete = (doc) => {
    Alert.alert('Удаление документа', `Удалить документ «${doc.title}»?`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          try {
            await documentsApi.deleteDocument(doc.id);
            setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
          } catch (err) {
            Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось удалить документ');
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }) => {
    const statusInfo = STATUS_INFO[item.status] || { label: item.status, color: colors.textSecondary };
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('DocumentManage', { documentId: item.id })}
      >
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusInfo.color + '20' }]}>
            <Text style={[styles.statusText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
          </View>
        </View>
        {!!item.category_title && (
          <Text style={[styles.cardCategory, { color: colors.textSecondary }]}>{item.category_title}</Text>
        )}
        {!!item.description && (
          <Text style={[styles.cardDescription, { color: colors.textSecondary }]} numberOfLines={2}>
            {item.description}
          </Text>
        )}
        <View style={styles.cardFooter}>
          {item.approval_required && (
            <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>
              Согласование: {item.approved_count}/{item.approvers_count}
            </Text>
          )}
          <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>
            Ознакомились: {item.confirmed_count}/{item.assignees_count}
          </Text>
        </View>
        <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item)}>
          <Icon name="trash-outline" size={18} color={colors.error || '#e53935'} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={[styles.createButton, { backgroundColor: colors.primary }]}
          onPress={() => navigation.navigate('CreateDocument', { categoryId, categoryTitle })}
        >
          <Icon name="add" size={20} color="#fff" />
          <Text style={styles.createButtonText}>Новый документ</Text>
        </TouchableOpacity>
      </View>

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
              <Icon name="document-text-outline" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Документов пока нет</Text>
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
  topBar: { padding: 16, paddingBottom: 0 },
  createButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: 10,
  },
  createButtonText: { color: '#fff', fontWeight: 'bold', marginLeft: 6 },
  listContent: { padding: 16 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 16, fontWeight: 'bold', flex: 1, marginRight: 8 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 11, fontWeight: 'bold' },
  cardCategory: { fontSize: 12, marginTop: 4 },
  cardDescription: { fontSize: 13, marginTop: 6 },
  cardFooter: { flexDirection: 'row', marginTop: 10 },
  cardMeta: { fontSize: 12, marginRight: 16 },
  deleteBtn: { position: 'absolute', right: 10, bottom: 10, padding: 4 },
  emptyContainer: { alignItems: 'center', marginTop: 60 },
  emptyText: { marginTop: 12, fontSize: 15 },
});
