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

const FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'confirmed', label: 'Ознакомились' },
  { key: 'pending', label: 'Не ознакомились' },
];

export default function DocumentReportScreen({ route }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { documentId } = route.params;

  const [report, setReport] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [reminding, setReminding] = useState(false);

  const loadReport = useCallback(async (statusFilter) => {
    setLoading(true);
    try {
      const res = await documentsApi.getReport(documentId, { status_filter: statusFilter });
      setReport(res.data);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить отчёт');
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useFocusEffect(useCallback(() => { loadReport(filter); }, [loadReport, filter]));

  const handleRemind = async () => {
    setReminding(true);
    try {
      const res = await documentsApi.remindDocument(documentId);
      Alert.alert('Готово', `Напоминание отправлено: ${res.data.reminded_count}`);
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось отправить напоминание');
    } finally {
      setReminding(false);
    }
  };

  const renderItem = ({ item }) => {
    const confirmed = item.status === 'confirmed';
    const userName = `${item.user.first_name || ''} ${item.user.last_name || ''}`.trim() || `#${item.user.id}`;
    return (
      <View style={[styles.row, { borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.userName, { color: colors.text }]}>{userName}</Text>
          <Text style={[styles.userRole, { color: colors.textSecondary }]}>{getRoleLabel(item.user.role)}</Text>
        </View>
        {confirmed ? (
          <View style={styles.statusCol}>
            <Icon name="checkmark-circle" size={18} color="#43a047" />
            <Text style={styles.confirmedDate}>
              {item.confirmed_at ? new Date(item.confirmed_at).toLocaleDateString('ru-RU') : ''}
            </Text>
          </View>
        ) : (
          <View style={styles.statusCol}>
            <Icon name="time-outline" size={18} color="#f59e0b" />
            <Text style={styles.pendingLabel}>Не ознакомился</Text>
          </View>
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
          {report.confirmed_count} из {report.total} ознакомились
        </Text>
        <TouchableOpacity
          style={[styles.remindBtn, { backgroundColor: colors.primary }]}
          onPress={handleRemind}
          disabled={reminding}
        >
          {reminding ? <ActivityIndicator color="#fff" size="small" /> : (
            <Text style={styles.remindBtnText}>Напомнить</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, { borderColor: colors.border, backgroundColor: filter === f.key ? colors.primary : colors.surface }]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterChipText, { color: filter === f.key ? '#fff' : colors.text }]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={report.items}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Нет записей по выбранному фильтру</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  progressBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16,
  },
  progressText: { fontSize: 16, fontWeight: 'bold' },
  remindBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  remindBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 10 },
  filterChip: { borderWidth: 1, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 12, marginRight: 8 },
  filterChipText: { fontSize: 12, fontWeight: '600' },
  listContent: { paddingHorizontal: 16, paddingBottom: 20 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  userName: { fontSize: 14, fontWeight: '600' },
  userRole: { fontSize: 12, marginTop: 2 },
  statusCol: { alignItems: 'flex-end' },
  confirmedDate: { fontSize: 11, color: '#43a047', marginTop: 2 },
  pendingLabel: { fontSize: 11, color: '#f59e0b', marginTop: 2 },
  emptyContainer: { alignItems: 'center', marginTop: 40 },
  emptyText: { fontSize: 14 },
});
