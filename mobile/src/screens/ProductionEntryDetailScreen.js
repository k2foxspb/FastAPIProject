import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Alert, Modal, TouchableWithoutFeedback, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { timesheetApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { useNotifications } from '../context/NotificationContext';
import { formatName } from '../utils/formatters';

const STATUS_LABELS = {
  draft: 'Черновик',
  pending: 'На согласовании',
  approved: 'Подтверждено',
  rejected: 'Отклонено',
};

const STATUS_COLORS = {
  draft: '#9CA3AF',
  pending: '#F59E0B',
  approved: '#10B981',
  rejected: '#EF4444',
};

const ACTION_LABELS = {
  created: 'Создана',
  updated: 'Изменена',
  submitted: 'Отправлена на согласование',
  resubmitted: 'Повторно отправлена на согласование',
  approved: 'Подтверждена',
  rejected: 'Отклонена',
};

// Карточка записи о сданной продукции для вышестоящего пользователя:
// данные сотрудника, часы из табеля, позиции продукции, подтверждение/
// отклонение с обязательным комментарием и журнал изменений.
export default function ProductionEntryDetailScreen({ navigation, route }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser } = useNotifications();
  const { entryId } = route.params;

  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [rejectComment, setRejectComment] = useState('');

  const fetchEntry = useCallback(async () => {
    try {
      const res = await timesheetApi.getProductionEntry(entryId);
      setEntry(res.data);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить запись');
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useFocusEffect(useCallback(() => { fetchEntry(); }, [fetchEntry]));

  const handleApprove = () => {
    Alert.alert(
      'Подтвердить запись',
      'Вы уверены, что хотите подтвердить сданную продукцию за этот день?',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Подтвердить',
          onPress: async () => {
            setActionLoading(true);
            try {
              await timesheetApi.approveProductionEntry(entryId);
              navigation.goBack();
            } catch (err) {
              Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось подтвердить запись');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleReject = async () => {
    if (!rejectComment.trim()) {
      Alert.alert('Ошибка', 'Комментарий обязателен при отклонении');
      return;
    }
    setActionLoading(true);
    try {
      await timesheetApi.rejectProductionEntry(entryId, rejectComment.trim());
      setRejectModalVisible(false);
      navigation.goBack();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось отклонить запись');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading || !entry) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const canReview = entry.status === 'pending' && currentUser && entry.user_id !== currentUser.id;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.employeeName, { color: colors.text }]}>{formatName(entry.user)}</Text>
          <Text style={[styles.date, { color: colors.textSecondary }]}>{entry.date}</Text>
          <Text style={[styles.hours, { color: colors.textSecondary }]}>
            Основное время: {entry.base_hours != null ? entry.base_hours : '—'} ч
            {entry.overtime_hours > 0 ? `, сверхурочное: ${entry.overtime_hours} ч` : ''}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[entry.status] || colors.border) + '22', alignSelf: 'flex-start' }]}>
            <Text style={[styles.statusText, { color: STATUS_COLORS[entry.status] || colors.textSecondary }]}>
              {STATUS_LABELS[entry.status] || entry.status}
            </Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Продукция</Text>
        {entry.items.map(item => (
          <View key={item.id} style={[styles.itemRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.itemName, { color: colors.text }]}>{item.product?.name || `#${item.product_id}`}</Text>
            <Text style={[styles.itemQty, { color: colors.textSecondary }]}>
              {item.quantity} {item.product?.unit || ''}
            </Text>
            {item.comment ? (
              <Text style={[styles.itemComment, { color: colors.textSecondary }]}>{item.comment}</Text>
            ) : null}
          </View>
        ))}

        {entry.status === 'rejected' && entry.reviewer_comment ? (
          <View style={[styles.rejectBox, { borderColor: colors.error }]}>
            <Text style={[styles.rejectTitle, { color: colors.error }]}>Причина отклонения</Text>
            <Text style={[styles.rejectText, { color: colors.text }]}>{entry.reviewer_comment}</Text>
          </View>
        ) : null}

        {entry.logs?.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Журнал изменений</Text>
            {entry.logs.map(log => (
              <View key={log.id} style={[styles.logRow, { borderColor: colors.border }]}>
                <Text style={[styles.logAction, { color: colors.text }]}>
                  {ACTION_LABELS[log.action] || log.action} · {formatName(log.actor) || 'Система'}
                </Text>
                <Text style={[styles.logDate, { color: colors.textSecondary }]}>
                  {new Date(log.created_at).toLocaleString()}
                </Text>
                {log.comment ? (
                  <Text style={[styles.logComment, { color: colors.textSecondary }]}>{log.comment}</Text>
                ) : null}
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {canReview && (
        <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
          <TouchableOpacity
            style={[styles.footerBtn, { backgroundColor: colors.error }]}
            onPress={() => setRejectModalVisible(true)}
            disabled={actionLoading}
          >
            <Text style={styles.footerBtnText}>Отклонить</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.footerBtn, { backgroundColor: colors.success || '#10B981' }]}
            onPress={handleApprove}
            disabled={actionLoading}
          >
            {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.footerBtnText}>Подтвердить</Text>}
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={rejectModalVisible} transparent animationType="slide" onRequestClose={() => setRejectModalVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setRejectModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior="padding" style={{ width: '100%' }}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Причина отклонения</Text>
                  <TextInput
                    style={[styles.modalInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={rejectComment}
                    onChangeText={setRejectComment}
                    placeholder="Опишите, что нужно исправить..."
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
                    {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.footerBtnText}>Отклонить запись</Text>}
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
  scroll: { padding: 15, paddingBottom: 30 },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 15 },
  employeeName: { fontSize: 18, fontWeight: '700' },
  date: { fontSize: 14, marginTop: 4 },
  hours: { fontSize: 14, marginTop: 8 },
  statusBadge: { marginTop: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontWeight: 'bold' },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 8, marginTop: 5 },
  itemRow: { padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  itemName: { fontSize: 14, fontWeight: '600' },
  itemQty: { fontSize: 13, marginTop: 2 },
  itemComment: { fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  rejectBox: { borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 5, marginBottom: 15 },
  rejectTitle: { fontSize: 13, fontWeight: 'bold' },
  rejectText: { fontSize: 13, marginTop: 4 },
  logRow: { borderBottomWidth: 1, paddingVertical: 8 },
  logAction: { fontSize: 13, fontWeight: '600' },
  logDate: { fontSize: 11, marginTop: 2 },
  logComment: { fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  footer: { flexDirection: 'row', padding: 15, borderTopWidth: 1 },
  footerBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', marginHorizontal: 5 },
  footerBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: 'bold', marginBottom: 12 },
  modalInput: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, textAlignVertical: 'top', minHeight: 90 },
  modalSaveBtn: { marginTop: 15, padding: 14, borderRadius: 10, alignItems: 'center' },
});
