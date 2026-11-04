import React, { useLayoutEffect, useMemo } from 'react';
import { SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useJournalQuery } from '../../context/JournalContext';
import { EmptyState, JournalGate, useColors } from '../../components/journal/common';
import { eventsInRange } from '../../journal/db/repos/events';
import { formatDateRu, formatTime } from '../../journal/utils/dates';

const KIND_ICONS = { meal: 'restaurant-outline', payment: 'card-outline', note: 'document-text-outline', tracker: 'pulse-outline', custom: 'star-outline' };

const MonthContent = ({ navigation, start, end }) => {
  const colors = useColors();
  const { data } = useJournalQuery(() => eventsInRange(start, end), [start, end]);

  const sections = useMemo(() => {
    const groups = {};
    (data || []).forEach((inst) => {
      if (!groups[inst.date]) groups[inst.date] = [];
      groups[inst.date].push(inst);
    });
    return Object.keys(groups).sort().map((date) => ({ date, data: groups[date] }));
  }, [data]);

  const renderItem = ({ item }) => {
    const done = item.status === 'done';
    const skipped = item.status === 'skipped';
    return (
      <TouchableOpacity style={[styles.item, { backgroundColor: 'transparent' }]} onPress={() => navigation.navigate('JournalDay', { date: item.date })}>
        <Icon name={done ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={done ? colors.success : colors.textSecondary} />
        <View style={styles.itemBody}>
          <Text style={[styles.itemTitle, { color: colors.text }, (done || skipped) && styles.strike]} numberOfLines={2}>{item.title}</Text>
          <Text style={[styles.itemSub, { color: colors.textSecondary }]}>
            {item.time ? formatTime(item.time) : 'весь день'}{item.recurring ? ' · повторяется' : ''}{skipped ? ' · пропущено' : ''}
          </Text>
        </View>
        <Icon name={KIND_ICONS[item.kind] || 'star-outline'} size={18} color={item.color || colors.textSecondary} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionList
        sections={sections}
        keyExtractor={(item, index) => `${item.event_uuid}:${item.original_date || ''}:${index}`}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{formatDateRu(section.date, { withWeekday: true, withYear: false })}</Text>
        )}
        ListEmptyComponent={data ? (
          <EmptyState icon="calendar-clear-outline" title="В этом месяце нет событий" subtitle="Добавьте событие в журнале" />
        ) : null}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 32 }}
      />
    </View>
  );
};

export default function MonthEventsScreen({ navigation, route }) {
  const { start, end } = route.params || {};
  useLayoutEffect(() => {
    navigation.setOptions({ title: 'События за месяц' });
  }, [navigation]);
  return (
    <JournalGate navigation={navigation}>
      <MonthContent navigation={navigation} start={start} end={end} />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginTop: 16, marginBottom: 6, marginHorizontal: 16 },
  item: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 6, borderRadius: 12, padding: 12 },
  itemBody: { flex: 1, marginHorizontal: 12 },
  itemTitle: { fontSize: 16 },
  itemSub: { fontSize: 13, marginTop: 2 },
  strike: { textDecorationLine: 'line-through', opacity: 0.6 },
});
