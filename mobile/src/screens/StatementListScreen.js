import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl,
  Alert, Modal, TextInput, TouchableWithoutFeedback, KeyboardAvoidingView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { statementsApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { formatName, parseISODate } from '../utils/formatters';

const STATUS_LABELS = {
  pending: 'На согласовании',
  approved: 'Согласовано',
  rejected: 'Отклонено',
  notified: 'Уведомлён',
};

const STATUS_COLORS = {
  pending: '#F59E0B',
  approved: '#10B981',
  rejected: '#EF4444',
};

const formatDateTime = (value) => {
  const d = parseISODate(value);
  if (!d) return '';
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

// Список заявлений: вкладка "Мои" - заявления, созданные текущим
// пользователем (с историей согласования), вкладка "На согласовании" -
// заявления, ожидающие решения текущего пользователя как согласующего
// (см. GET /statements/my и GET /statements/pending).
export default function StatementListScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [tab, setTab] = useState('pending');
  const [myStatements, setMyStatements] = useState([]);
  const [pendingStatements, setPendingStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectComment, setRejectComment] = useState('');

  const fetchStatements = useCallback(async () => {
    try {
      const [myRes, pendingRes] = await Promise.all([
        statementsApi.getMyStatements(),
        statementsApi.getPendingStatements(),
      ]);
      setMyStatements(myRes.data);
      setPendingStatements(pendingRes.data);
    } catch (err) {
      // молча игнорируем - списки просто останутся пустыми
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchStatements(); }, [fetchStatements]));

  const onRefresh = () => {
    setRefreshing(true);
    fetchStatements();
  };

  const handleApprove = (item) => {
    Alert.alert(
      'Подтвердить заявление',
      `Подтвердить заявление от ${formatName(item.author)}?`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Подтвердить',
          onPress: async () => {
            setActionLoading(true);
            try {
              await statementsApi.approveStatement(item.id);
              await fetchStatements();
            } catch (err) {
              Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось подтвердить заявление');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  const openRejectModal = (item) => {
    setRejectTarget(item);
    setRejectComment('');
  };

  const handleReject = async () => {
    if (!rejectComment.trim()) {
      Alert.alert('Ошибка', 'Комментарий обязателен при отклонении');
      return;
    }
    setActionLoading(true);
    try {
      await statementsApi.rejectStatement(rejectTarget.id, rejectComment.trim());
      setRejectTarget(null);
      await fetchStatements();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось отклонить заявление');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const data = tab === 'my' ? myStatements : pendingStatements;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.tabsRow, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'pending' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setTab('pending')}
        >
          <Text style={[styles.tabText, { color: tab === 'pending' ? colors.primary : colors.textSecondary }]}>
            На согласовании{pendingStatements.length > 0 ? ` (${pendingStatements.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'my' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setTab('my')}
        >
          <Text style={[styles.tabText, { color: tab === 'my' ? colors.primary : colors.textSecondary }]}>
            Мои заявления
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={data}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.authorName, { color: colors.text }]}>
                {tab === 'pending' ? formatName(item.author) : 'Моё заявление'}
              </Text>
              <Text style={[styles.statusLabel, { color: STATUS_COLORS[item.status] || colors.textSecondary }]}>
                {STATUS_LABELS[item.status] || item.status}
              </Text>
            </View>
            {item.template_name && (
              <Text style={[styles.templateLabel, { color: colors.textSecondary }]}>Шаблон: {item.template_name}</Text>
            )}
            <Text style={[styles.message, { color: colors.text }]}>{item.message}</Text>
            <Text style={[styles.date, { color: colors.textSecondary }]}>{formatDateTime(item.created_at)}</Text>

            {item.status === 'pending' && item.pending_approvers.length > 0 && (
              <Text style={[styles.pendingHint, { color: colors.textSecondary }]}>
                Ожидает: {item.pending_approvers.map(a => formatName(a) || `#${a.id}`).join(', ')}
              </Text>
            )}
            {item.status === 'rejected' && item.reviewer_comment ? (
              <Text style={[styles.rejectComment, { color: colors.error }]}>Причина отклонения: {item.reviewer_comment}</Text>
            ) : null}

            {item.approvals.length > 0 && (
              <View style={[styles.approvalsBlock, { borderColor: colors.border }]}>
                {item.approvals.map(a => (
                  <Text key={a.approver_id} style={[styles.approvalLine, { color: colors.textSecondary }]}>
                    {formatName(a.approver) || `#${a.approver_id}`}: {STATUS_LABELS[a.status] || a.status}
                    {a.decided_at ? ` (${formatDateTime(a.decided_at)})` : ''}
                    {a.status === 'rejected' && a.comment ? ` - ${a.comment}` : ''}
                  </Text>
                ))}
              </View>
            )}

            {tab === 'pending' && (
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.error }]}
                  onPress={() => openRejectModal(item)}
                  disabled={actionLoading}
                >
                  <Text style={styles.actionBtnText}>Отклонить</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.success || '#10B981' }]}
                  onPress={() => handleApprove(item)}
                  disabled={actionLoading}
                >
                  <Text style={styles.actionBtnText}>Подтвердить</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Icon name="document-text-outline" size={56} color={colors.border} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {tab === 'pending' ? 'Нет заявлений, ожидающих вашего согласования' : 'Вы ещё не создавали заявлений'}
            </Text>
          </View>
        }
      />

      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => navigation.navigate('StatementForm')}
      >
        <Icon name="add" size={28} color="#fff" />
      </TouchableOpacity>

      <Modal visible={!!rejectTarget} transparent animationType="slide" onRequestClose={() => setRejectTarget(null)}>
        <TouchableWithoutFeedback onPress={() => setRejectTarget(null)}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior="padding" style={{ width: '100%' }}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Причина отклонения</Text>
                  <TextInput
                    style={[styles.modalInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={rejectComment}
                    onChangeText={setRejectComment}
                    placeholder="Опишите причину отклонения..."
                    placeholderTextColor={colors.textSecondary}
                    multiline
                    numberOfLines={4}
                    autoFocus
                  />
                  <TouchableOpacity
                    style={[styles.modalSaveBtn, { backgroundColor: colors.error }]}
                    onPress={handleReject}
                    disabled={actionLoading}
                  >
                    {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>Отклонить заявление</Text>}
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tabsRow: { flexDirection: 'row', borderBottomWidth: 1 },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabText: { fontSize: 14, fontWeight: '600' },
  list: { padding: 15, paddingBottom: 90 },
  card: { padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  authorName: { fontSize: 15, fontWeight: '700' },
  statusLabel: { fontSize: 12, fontWeight: 'bold' },
  templateLabel: { fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  message: { fontSize: 14, marginTop: 8 },
  date: { fontSize: 12, marginTop: 6 },
  pendingHint: { fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  rejectComment: { fontSize: 13, marginTop: 6, fontStyle: 'italic' },
  approvalsBlock: { borderTopWidth: 1, marginTop: 10, paddingTop: 8 },
  approvalLine: { fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', marginTop: 12 },
  actionBtn: { flex: 1, padding: 10, borderRadius: 8, alignItems: 'center', marginHorizontal: 4 },
  actionBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  emptyWrap: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: 15, marginTop: 10, textAlign: 'center', paddingHorizontal: 30 },
  fab: {
    position: 'absolute', right: 20, bottom: 20, width: 56, height: 56, borderRadius: 28,
    justifyContent: 'center', alignItems: 'center', elevation: 4,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: 'bold', marginBottom: 12 },
  modalInput: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, textAlignVertical: 'top', minHeight: 90 },
  modalSaveBtn: { marginTop: 15, padding: 14, borderRadius: 10, alignItems: 'center' },
});
