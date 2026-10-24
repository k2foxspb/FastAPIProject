import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { documentsApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { getRoleLabel } from '../constants/roles';

const STATUS_INFO = {
  pending: { label: 'Ожидает', color: '#f59e0b', icon: 'time-outline' },
  approved: { label: 'Согласовал', color: '#43a047', icon: 'checkmark-circle' },
  rejected: { label: 'Отклонил', color: '#e53935', icon: 'close-circle' },
};

export default function DocumentApprovalReportScreen({ route }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { documentId } = route.params;

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reminding, setReminding] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await documentsApi.getApprovalReport(documentId);
      setReport(res.data);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить отчёт по согласованию');
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useFocusEffect(useCallback(() => { loadReport(); }, [loadReport]));

  const handleRemind = async () => {
    setReminding(true);
    try {
      const res = await documentsApi.remindApprovers(documentId);
      Alert.alert('Готово', `Напоминание отправлено: ${res.data.reminded_count}`);
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось отправить напоминание');
    } finally {
      setReminding(false);
    }
  };

  const renderItem = ({ item }) => {
    const info = STATUS_INFO[item.status] || STATUS_INFO.pending;
    const name = item.approver
      ? `${item.approver.first_name || ''} ${item.approver.last_name || ''}`.trim() || `#${item.approver_user_id}`
      : `#${item.approver_user_id}`;
    const date = item.approved_at || item.rejected_at;
    return (
      <View style={[styles.row, { borderBottomColor: colors.border }]}>
        <View style={styles.rowHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.userName, { color: colors.text }]}>{name}</Text>
            {item.approver?.role && (
              <Text style={[styles.userRole, { color: colors.textSecondary }]}>{getRoleLabel(item.approver.role)}</Text>
            )}
          </View>
          <View style={styles.statusCol}>
            <Icon name={info.icon} size={18} color={info.color} />
            <Text style={[styles.statusLabel, { color: info.color }]}>{info.label}</Text>
          </View>
        </View>
        {date && (
          <Text style={[styles.dateText, { color: colors.textSecondary }]}>
            {new Date(date).toLocaleString('ru-RU')}
          </Text>
        )}
        {!!item.comment && (
          <Text style={[styles.commentText, { color: colors.text }]}>«{item.comment}»</Text>
        )}
      </View>
    );
  };

  if (loading || !report) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.progressBox}>
        <Text style={[styles.progressText, { color: colors.text }]}>
          {report.approved_count} из {report.total} подписантов согласовали
        </Text>
        {report.pending_count > 0 && (
          <TouchableOpacity
            style={[styles.remindBtn, { backgroundColor: colors.primary }]}
            onPress={handleRemind}
            disabled={reminding}
          >
            {reminding ? <ActivityIndicator color="#fff" size="small" /> : (
              <Text style={styles.remindBtnText}>Напомнить</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={report.approvals}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Подписанты не назначены</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  progressBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16,
  },
  progressText: { fontSize: 15, fontWeight: 'bold', flex: 1, marginRight: 10 },
  remindBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  remindBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  listContent: { paddingHorizontal: 16, paddingBottom: 20 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  userName: { fontSize: 14, fontWeight: '600' },
  userRole: { fontSize: 12, marginTop: 2 },
  statusCol: { alignItems: 'flex-end' },
  statusLabel: { fontSize: 11, fontWeight: 'bold', marginTop: 2 },
  dateText: { fontSize: 12, marginTop: 4 },
  commentText: { fontSize: 13, marginTop: 6, fontStyle: 'italic' },
  emptyContainer: { alignItems: 'center', marginTop: 40 },
  emptyText: { fontSize: 14 },
});
