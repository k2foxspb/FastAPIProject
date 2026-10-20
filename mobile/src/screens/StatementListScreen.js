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
  draft: 'Черновик',
  pending: 'На согласовании',
  revision: 'На доработке',
  resubmitted: 'Повторно на согласовании',
  approved: 'Согласовано',
  rejected: 'Отклонено',
  cancelled: 'Отменено',
  notified: 'Уведомлён',
};

const STATUS_COLORS = {
  draft: '#6B7280',
  pending: '#F59E0B',
  revision: '#EF4444',
  resubmitted: '#3B82F6',
  approved: '#10B981',
  rejected: '#DC2626',
  cancelled: '#9CA3AF',
};

const ACTION_LABELS = {
  draft_created: 'Создан черновик',
  submitted: 'Отправлено на согласование',
  approved: 'Согласовано',
  returned_for_revision: 'Возвращено на доработку',
  resubmitted: 'Повторно отправлено',
  edited: 'Отредактировано',
  fully_approved: 'Полностью утверждено',
  cancelled: 'Отменено',
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

  // Состояние для диалога повторной отправки (доработки)
  const [resubmitTarget, setResubmitTarget] = useState(null);
  const [resubmitMessage, setResubmitMessage] = useState('');
  const [resubmitMode, setResubmitMode] = useState('all'); // 'all' | 'rejected_only'

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
      Alert.alert('Ошибка', 'Комментарий обязателен при возврате на доработку');
      return;
    }
    setActionLoading(true);
    try {
      await statementsApi.rejectStatement(rejectTarget.id, rejectComment.trim());
      setRejectTarget(null);
      await fetchStatements();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось вернуть заявление на доработку');
    } finally {
      setActionLoading(false);
    }
  };

  const openResubmitModal = (item) => {
    setResubmitTarget(item);
    setResubmitMessage(item.message || '');
    setResubmitMode('all');
  };

  const confirmAndResubmit = () => {
    if (!resubmitMessage.trim()) {
      Alert.alert('Ошибка', 'Текст заявления не может быть пустым');
      return;
    }

    const confirmTitle = 'Подтверждение повторной отправки';
    const confirmMessage = resubmitMode === 'all'
      ? 'Заявление будет направлено повторно ВСЕМ согласующим (прежние согласования сбросятся). Продолжить?'
      : 'Заявление будет направлено ТОЛЬКО руководителю(-ям), вернувшему на доработку (согласования остальных сохранятся). Продолжить?';

    Alert.alert(confirmTitle, confirmMessage, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Отправить',
        onPress: async () => {
          setActionLoading(true);
          try {
            await statementsApi.resubmitStatement(resubmitTarget.id, {
              message: resubmitMessage.trim(),
              mode: resubmitMode,
            });
            setResubmitTarget(null);
            await fetchStatements();
            Alert.alert('Успешно', 'Заявление повторно отправлено на согласование');
          } catch (err) {
            Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось отправить заявление');
          } finally {
            setActionLoading(false);
          }
        },
      },
    ]);
  };

  const handleSubmitDraft = (item) => {
    Alert.alert(
      'Отправить черновик',
      'Отправить заявление на согласование руководителям?',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Отправить',
          onPress: async () => {
            setActionLoading(true);
            try {
              await statementsApi.submitDraftStatement(item.id);
              await fetchStatements();
            } catch (err) {
              Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось отправить черновик');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleCancelStatement = (item) => {
    Alert.alert(
      'Отменить заявление',
      'Вы уверены, что хотите отменить это заявление?',
      [
        { text: 'Нет', style: 'cancel' },
        {
          text: 'Отменить заявление',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              await statementsApi.cancelStatement(item.id);
              await fetchStatements();
            } catch (err) {
              Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось отменить заявление');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
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
              <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[item.status] || colors.textSecondary) + '20' }]}>
                <Text style={[styles.statusLabel, { color: STATUS_COLORS[item.status] || colors.textSecondary }]}>
                  {STATUS_LABELS[item.status] || item.status}
                </Text>
              </View>
            </View>

            {item.template_name && (
              <Text style={[styles.templateLabel, { color: colors.textSecondary }]}>Шаблон: {item.template_name}</Text>
            )}
            <Text style={[styles.message, { color: colors.text }]}>{item.message}</Text>
            <Text style={[styles.date, { color: colors.textSecondary }]}>{formatDateTime(item.created_at)}</Text>

            {/* Блок для заявлений на доработке */}
            {item.status === 'revision' && (
              <View style={[styles.revisionBox, { backgroundColor: '#FEE2E2', borderColor: '#EF4444' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                  <Icon name="alert-circle" size={18} color="#DC2626" style={{ marginRight: 6 }} />
                  <Text style={[styles.revisionTitle, { color: '#DC2626' }]}>
                    Возвращено на доработку: {formatName(item.reviewer) || 'Руководитель'}
                  </Text>
                </View>
                {item.reviewer_comment ? (
                  <Text style={[styles.revisionReason, { color: '#991B1B' }]}>
                    Причина: {item.reviewer_comment}
                  </Text>
                ) : null}
              </View>
            )}

            {(item.status === 'pending' || item.status === 'resubmitted') && item.pending_approvers.length > 0 && (
              <Text style={[styles.pendingHint, { color: colors.textSecondary }]}>
                Ожидает: {item.pending_approvers.map(a => formatName(a) || `#${a.id}`).join(', ')}
              </Text>
            )}

            {/* Текущие статусы согласующих */}
            {item.approvals && item.approvals.length > 0 && (
              <View style={[styles.approvalsBlock, { borderColor: colors.border }]}>
                <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>Согласующие:</Text>
                {item.approvals.map(a => (
                  <Text key={a.approver_id} style={[styles.approvalLine, { color: colors.textSecondary }]}>
                    • {formatName(a.approver) || `#${a.approver_id}`}: {STATUS_LABELS[a.status] || a.status}
                    {a.decided_at ? ` (${formatDateTime(a.decided_at)})` : ''}
                    {a.comment ? ` - ${a.comment}` : ''}
                  </Text>
                ))}
              </View>
            )}

            {/* История действий (Audit Log) */}
            {item.logs && item.logs.length > 0 && (
              <View style={[styles.approvalsBlock, { borderColor: colors.border, marginTop: 8 }]}>
                <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>История решений:</Text>
                {item.logs.map(log => (
                  <Text key={log.id} style={[styles.historyLine, { color: colors.textSecondary }]}>
                    [{formatDateTime(log.created_at)}] {ACTION_LABELS[log.action] || log.action}
                    {log.actor ? ` (${formatName(log.actor)})` : ''}
                    {log.resubmit_mode ? ` [${log.resubmit_mode === 'all' ? 'всем повторно' : 'только вернувшему'}]` : ''}
                    {log.comment ? `: "${log.comment}"` : ''}
                  </Text>
                ))}
              </View>
            )}

            {/* Действия согласующего */}
            {tab === 'pending' && (
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.error }]}
                  onPress={() => openRejectModal(item)}
                  disabled={actionLoading}
                >
                  <Text style={styles.actionBtnText}>Вернуть на доработку</Text>
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

            {/* Действия автора для заявления на доработке или черновика */}
            {tab === 'my' && item.status === 'revision' && (
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.primary }]}
                  onPress={() => openResubmitModal(item)}
                  disabled={actionLoading}
                >
                  <Text style={styles.actionBtnText}>Доработать и отправить</Text>
                </TouchableOpacity>
              </View>
            )}

            {tab === 'my' && item.status === 'draft' && (
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.primary }]}
                  onPress={() => handleSubmitDraft(item)}
                  disabled={actionLoading}
                >
                  <Text style={styles.actionBtnText}>Отправить на согласование</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.border }]}
                  onPress={() => handleCancelStatement(item)}
                  disabled={actionLoading}
                >
                  <Text style={[styles.actionBtnText, { color: colors.text }]}>Удалить</Text>
                </TouchableOpacity>
              </View>
            )}

            {tab === 'my' && (item.status === 'pending' || item.status === 'resubmitted') && (
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#9CA3AF' }]}
                  onPress={() => handleCancelStatement(item)}
                  disabled={actionLoading}
                >
                  <Text style={styles.actionBtnText}>Отозвать заявление</Text>
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

      {/* Модальное окно возврата на доработку */}
      <Modal visible={!!rejectTarget} transparent animationType="slide" onRequestClose={() => setRejectTarget(null)}>
        <TouchableWithoutFeedback onPress={() => setRejectTarget(null)}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior="padding" style={{ width: '100%' }}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Причина возврата на доработку</Text>
                  <TextInput
                    style={[styles.modalInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={rejectComment}
                    onChangeText={setRejectComment}
                    placeholder="Опишите замечания или причину доработки..."
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
                    {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>Вернуть на доработку</Text>}
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Модальное окно повторной отправки (доработки) */}
      <Modal visible={!!resubmitTarget} transparent animationType="slide" onRequestClose={() => setResubmitTarget(null)}>
        <TouchableWithoutFeedback onPress={() => setResubmitTarget(null)}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior="padding" style={{ width: '100%' }}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Повторная отправка заявления</Text>

                  {resubmitTarget?.reviewer_comment ? (
                    <View style={[styles.revisionBox, { backgroundColor: '#FEE2E2', borderColor: '#EF4444', marginBottom: 12 }]}>
                      <Text style={{ fontSize: 12, color: '#991B1B', fontWeight: 'bold' }}>
                        Замечание ({formatName(resubmitTarget?.reviewer) || 'Руководитель'}):
                      </Text>
                      <Text style={{ fontSize: 13, color: '#7F1D1D', marginTop: 2 }}>
                        {resubmitTarget.reviewer_comment}
                      </Text>
                    </View>
                  ) : null}

                  <Text style={[styles.sectionSubtitle, { color: colors.text, marginBottom: 6 }]}>Отредактируйте текст заявления:</Text>
                  <TextInput
                    style={[styles.modalInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={resubmitMessage}
                    onChangeText={setResubmitMessage}
                    placeholder="Текст заявления..."
                    placeholderTextColor={colors.textSecondary}
                    multiline
                    numberOfLines={4}
                  />

                  <Text style={[styles.sectionSubtitle, { color: colors.text, marginTop: 14, marginBottom: 8 }]}>
                    Вариант повторного согласования:
                  </Text>

                  <TouchableOpacity
                    style={[
                      styles.modeOption,
                      { borderColor: resubmitMode === 'all' ? colors.primary : colors.border },
                      resubmitMode === 'all' && { backgroundColor: colors.primary + '15' },
                    ]}
                    onPress={() => setResubmitMode('all')}
                  >
                    <Icon
                      name={resubmitMode === 'all' ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={resubmitMode === 'all' ? colors.primary : colors.textSecondary}
                      style={{ marginRight: 10 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modeTitle, { color: colors.text }]}>Согласовать заново со всеми</Text>
                      <Text style={[styles.modeDesc, { color: colors.textSecondary }]}>
                        Заявление будет отправлено всем согласующим повторно, прежние согласования сбросятся.
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.modeOption,
                      { borderColor: resubmitMode === 'rejected_only' ? colors.primary : colors.border, marginTop: 8 },
                      resubmitMode === 'rejected_only' && { backgroundColor: colors.primary + '15' },
                    ]}
                    onPress={() => setResubmitMode('rejected_only')}
                  >
                    <Icon
                      name={resubmitMode === 'rejected_only' ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={resubmitMode === 'rejected_only' ? colors.primary : colors.textSecondary}
                      style={{ marginRight: 10 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modeTitle, { color: colors.text }]}>Отправить только вернувшему на доработку</Text>
                      <Text style={[styles.modeDesc, { color: colors.textSecondary }]}>
                        Заявление будет направлено только руководителю, вернувшему его; согласования остальных сохранятся.
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.modalSaveBtn, { backgroundColor: colors.primary, marginTop: 18 }]}
                    onPress={confirmAndResubmit}
                    disabled={actionLoading}
                  >
                    {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>Отправить на согласование</Text>}
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
  card: { padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  authorName: { fontSize: 15, fontWeight: '700' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusLabel: { fontSize: 12, fontWeight: 'bold' },
  templateLabel: { fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  message: { fontSize: 14, marginTop: 8 },
  date: { fontSize: 12, marginTop: 6 },
  pendingHint: { fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  rejectComment: { fontSize: 13, marginTop: 6, fontStyle: 'italic' },
  revisionBox: { borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 10 },
  revisionTitle: { fontSize: 13, fontWeight: 'bold' },
  revisionReason: { fontSize: 13, marginTop: 2 },
  sectionSubtitle: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  approvalsBlock: { borderTopWidth: 1, marginTop: 10, paddingTop: 8 },
  approvalLine: { fontSize: 12, marginTop: 2 },
  historyLine: { fontSize: 11, marginTop: 2, fontStyle: 'italic' },
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
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '85%' },
  modalTitle: { fontSize: 17, fontWeight: 'bold', marginBottom: 12 },
  modalInput: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, textAlignVertical: 'top', minHeight: 80 },
  modeOption: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, padding: 10 },
  modeTitle: { fontSize: 13, fontWeight: 'bold' },
  modeDesc: { fontSize: 11, marginTop: 2 },
  modalSaveBtn: { marginTop: 15, padding: 14, borderRadius: 10, alignItems: 'center' },
});
