import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl,
  Alert, Modal, TextInput, TouchableWithoutFeedback, KeyboardAvoidingView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { timesheetApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { formatName, formatTimesheetDate } from '../utils/formatters';

// Список изменений часов в табеле, ожидающих согласования, видимых текущему
// пользователю по иерархии должностей (см. GET /timesheet/entries/pending).
export default function TimesheetApprovalListScreen() {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectComment, setRejectComment] = useState('');

  const fetchEntries = useCallback(async () => {
    try {
      const res = await timesheetApi.getPendingTimesheetEntries();
      setEntries(res.data);
    } catch (err) {
      // молча игнорируем - список просто останется пустым
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchEntries(); }, [fetchEntries]));

  const onRefresh = () => {
    setRefreshing(true);
    fetchEntries();
  };

  const handleApprove = (entry) => {
    Alert.alert(
      'Подтвердить изменение',
      `Подтвердить часы за ${formatTimesheetDate(entry.date)} для ${formatName(entry.user)}?`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Подтвердить',
          onPress: async () => {
            setActionLoading(true);
            try {
              await timesheetApi.approveTimesheetEntry(entry.id);
              await fetchEntries();
            } catch (err) {
              Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось подтвердить изменение');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  const openRejectModal = (entry) => {
    setRejectTarget(entry);
    setRejectComment('');
  };

  const handleReject = async () => {
    if (!rejectComment.trim()) {
      Alert.alert('Ошибка', 'Комментарий обязателен при отклонении');
      return;
    }
    setActionLoading(true);
    try {
      await timesheetApi.rejectTimesheetEntry(rejectTarget.id, rejectComment.trim());
      setRejectTarget(null);
      await fetchEntries();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось отклонить изменение');
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={entries}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.employeeName, { color: colors.text }]}>{formatName(item.user)}</Text>
              <Text style={[styles.date, { color: colors.textSecondary }]}>{formatTimesheetDate(item.date)}</Text>
            </View>
            <Text style={[styles.hours, { color: colors.textSecondary }]}>
              Основное время: {item.hours} ч{item.overtime_hours > 0 ? `, сверхурочное: ${item.overtime_hours} ч` : ''}
            </Text>
            {item.text_value ? (
              <Text style={[styles.hours, { color: colors.textSecondary }]}>Отметка: {item.text_value}</Text>
            ) : null}
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
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Icon name="checkmark-done-circle-outline" size={56} color={colors.border} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Нет изменений часов, ожидающих согласования</Text>
          </View>
        }
      />

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
                    {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>Отклонить изменение</Text>}
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
  list: { padding: 15 },
  card: { padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  employeeName: { fontSize: 15, fontWeight: '700' },
  date: { fontSize: 13 },
  hours: { fontSize: 13, marginTop: 6 },
  actions: { flexDirection: 'row', marginTop: 12 },
  actionBtn: { flex: 1, padding: 10, borderRadius: 8, alignItems: 'center', marginHorizontal: 4 },
  actionBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  emptyWrap: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: 15, marginTop: 10, textAlign: 'center', paddingHorizontal: 30 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: 'bold', marginBottom: 12 },
  modalInput: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, textAlignVertical: 'top', minHeight: 90 },
  modalSaveBtn: { marginTop: 15, padding: 14, borderRadius: 10, alignItems: 'center' },
});
