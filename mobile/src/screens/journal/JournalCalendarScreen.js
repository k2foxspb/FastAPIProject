import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Calendar } from 'react-native-calendars';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useJournal, useJournalQuery } from '../../context/JournalContext';
import { HeaderButton, JournalGate, Section, SyncBadge, useColors } from '../../components/journal/common';
import DayCell from '../../components/journal/DayCell';
import { calendarTheme } from '../../components/journal/DateTimeFields';
import { summarizeRange } from '../../journal/db/aggregates';
import { formatDateRu, monthBounds } from '../../journal/utils/dates';
import { formatKop } from '../../journal/utils/money';

const QUICK_ACTIONS = [
  { key: 'event', icon: 'add-circle-outline', label: 'Событие' },
  { key: 'diary', icon: 'book-outline', label: 'Дневник' },
  { key: 'tracker', icon: 'pulse-outline', label: 'Трекер' },
];

const CalendarContent = ({ navigation }) => {
  const colors = useColors();
  const { today, settings } = useJournal();
  const [month, setMonth] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [start, end] = monthBounds(month.year, month.month);
  const { data: days } = useJournalQuery(() => summarizeRange(start, end), [start, end]);

  const markedDates = useMemo(() => {
    const result = {};
    Object.values(days || {}).forEach((summary) => {
      result[summary.date] = { summary };
    });
    return result;
  }, [days]);

  const openDay = useCallback((date) => navigation.navigate('JournalDay', { date: date.dateString }), [navigation]);
  const renderDay = useCallback((props) => <DayCell {...props} colors={colors} onPress={openDay} />, [colors, openDay]);

  const totals = useMemo(() => {
    const t = { done: 0, total: 0, diary: 0, kcal: 0, expense: 0 };
    Object.values(days || {}).forEach((d) => {
      t.done += d.events_done;
      t.total += d.events_total;
      t.diary += d.has_diary ? 1 : 0;
      t.kcal += d.kcal;
      t.expense += d.expense_kop;
    });
    return t;
  }, [days]);

  const todaySummary = days?.[today];

  const onQuick = (key) => {
    if (key === 'event') navigation.navigate('EventEdit', { date: today });
    if (key === 'diary') navigation.navigate('DiaryEdit', { date: today });
    if (key === 'tracker') navigation.navigate('Trackers', { quickDate: today });
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={[styles.calendarWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Calendar
          key={`${colors.card}:${settings?.week_start || 1}`}
          current={start}
          firstDay={settings?.week_start === 7 ? 0 : 1}
          markedDates={markedDates}
          dayComponent={renderDay}
          onMonthChange={(m) => setMonth({ year: m.year, month: m.month })}
          enableSwipeMonths
          theme={calendarTheme(colors)}
        />
      </View>

      <View style={styles.quickRow}>
        {QUICK_ACTIONS.map((a) => (
          <TouchableOpacity
            key={a.key}
            style={[styles.quick, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => onQuick(a.key)}
          >
            <Icon name={a.icon} size={22} color={colors.primary} />
            <Text style={[styles.quickText, { color: colors.text }]}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Section title="Сегодня">
        <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('JournalDay', { date: today })}>
          <Text style={[styles.rowText, { color: colors.text }]}>{formatDateRu(today, { withWeekday: true })}</Text>
          <Text style={{ color: colors.textSecondary }}>
            {todaySummary?.events_total ? `${todaySummary.events_done}/${todaySummary.events_total} событий` : 'нет событий'}
          </Text>
          <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </Section>

      <Section title="За месяц">
        <View style={styles.statsRow}>
          <Stat colors={colors} value={`${totals.done}/${totals.total}`} label="события" />
          <Stat colors={colors} value={String(totals.diary)} label="дней с записями" />
          {totals.expense > 0 && <Stat colors={colors} value={formatKop(totals.expense, { withKopecks: false })} label="расходы" />}
        </View>
      </Section>

      <Section>
        <NavRow colors={colors} icon="book-outline" label="Дневник" onPress={() => navigation.navigate('DiaryList')} />
        <NavRow colors={colors} icon="pulse-outline" label="Трекеры" onPress={() => navigation.navigate('Trackers')} />
        <NavRow colors={colors} icon="settings-outline" label="Настройки журнала" onPress={() => navigation.navigate('JournalSettings')} last />
      </Section>
    </ScrollView>
  );
};

const Stat = ({ colors, value, label }) => (
  <View style={styles.stat}>
    <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
    <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
  </View>
);

const NavRow = ({ colors, icon, label, onPress, last }) => (
  <TouchableOpacity style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]} onPress={onPress}>
    <Icon name={icon} size={20} color={colors.primary} />
    <Text style={[styles.rowText, { color: colors.text, marginLeft: 12 }]}>{label}</Text>
    <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
  </TouchableOpacity>
);

export default function JournalCalendarScreen({ navigation }) {
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <SyncBadge />
          <HeaderButton icon="settings-outline" onPress={() => navigation.navigate('JournalSettings')} />
        </View>
      ),
    });
  }, [navigation]);
  return (
    <JournalGate navigation={navigation}>
      <CalendarContent navigation={navigation} />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  calendarWrap: { margin: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', paddingBottom: 6 },
  quickRow: { flexDirection: 'row', marginHorizontal: 8 },
  quick: { flex: 1, marginHorizontal: 4, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', paddingVertical: 12 },
  quickText: { marginTop: 4, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12 },
  rowText: { flex: 1, fontSize: 16 },
  statsRow: { flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 6 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '600' },
  statLabel: { fontSize: 12, marginTop: 2 },
});
