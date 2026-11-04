import React, { useLayoutEffect, useMemo } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useJournalQuery } from '../../context/JournalContext';
import { EmptyState, JournalGate, useColors } from '../../components/journal/common';
import { summarizeRange } from '../../journal/db/aggregates';
import { formatDateRu } from '../../journal/utils/dates';

const MonthKcalContent = ({ navigation, start, end }) => {
  const colors = useColors();
  const { data } = useJournalQuery(() => summarizeRange(start, end), [start, end]);

  const rows = useMemo(() => Object.values(data || {})
    .filter((d) => d.kcal > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1)), [data]);

  const total = useMemo(() => rows.reduce((s, d) => s + d.kcal, 0), [rows]);

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={[styles.item, { backgroundColor: 'transparent' }]}
      onPress={() => navigation.navigate('DietDay', { date: item.date })}
    >
      <Icon name="restaurant-outline" size={22} color={colors.primary} />
      <Text style={[styles.date, { color: colors.text }]}>{formatDateRu(item.date, { withWeekday: true, withYear: false })}</Text>
      <Text style={[styles.kcal, { color: colors.text }]}>{item.kcal} ккал</Text>
      <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.date}
        renderItem={renderItem}
        ListHeaderComponent={data ? (
          <Text style={[styles.total, { color: colors.textSecondary }]}>Всего за месяц: {total} ккал</Text>
        ) : null}
        ListEmptyComponent={data ? (
          <EmptyState icon="restaurant-outline" title="В этом месяце нет записей о еде" subtitle="Добавьте приём пищи в журнале" />
        ) : null}
        contentContainerStyle={{ paddingBottom: 32 }}
      />
    </View>
  );
};

export default function MonthKcalScreen({ navigation, route }) {
  const { start, end } = route.params || {};
  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Калории по дням' });
  }, [navigation]);
  return (
    <JournalGate navigation={navigation}>
      <MonthKcalContent navigation={navigation} start={start} end={end} />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  total: { fontSize: 13, fontWeight: '600', marginTop: 16, marginBottom: 6, marginHorizontal: 16 },
  item: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 6, borderRadius: 12, padding: 12 },
  date: { flex: 1, fontSize: 16, marginHorizontal: 12 },
  kcal: { fontSize: 16, fontWeight: '600', marginRight: 8 },
});
