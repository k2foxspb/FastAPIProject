import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { timesheetApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { formatName, formatTimesheetDate } from '../utils/formatters';

// Список записей о сданной продукции, ожидающих согласования, видимых
// текущему пользователю по иерархии должностей (см. GET /timesheet/production/entries/pending).
export default function ProductionApprovalListScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchEntries = useCallback(async () => {
    try {
      const res = await timesheetApi.getPendingEntries();
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
        renderItem={({ item }) => {
          const itemsSummary = item.items?.map(i => `${i.product?.name || i.product_id} × ${i.quantity}`).join(', ');
          return (
            <TouchableOpacity
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => navigation.navigate('ProductionEntryDetail', { entryId: item.id })}
            >
              <View style={styles.cardHeader}>
                <Text style={[styles.employeeName, { color: colors.text }]}>{formatName(item.user)}</Text>
                <Text style={[styles.date, { color: colors.textSecondary }]}>{formatTimesheetDate(item.date)}</Text>
              </View>
              <Text style={[styles.items, { color: colors.textSecondary }]} numberOfLines={2}>{itemsSummary || '—'}</Text>
              <Text style={[styles.hours, { color: colors.textSecondary }]}>Часы за день: {item.hours ?? '—'}</Text>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Icon name="checkmark-done-circle-outline" size={56} color={colors.border} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Нет записей, ожидающих согласования</Text>
          </View>
        }
      />
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
  items: { fontSize: 13, marginTop: 6 },
  hours: { fontSize: 12, marginTop: 4 },
  emptyWrap: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: 15, marginTop: 10, textAlign: 'center', paddingHorizontal: 30 },
});
