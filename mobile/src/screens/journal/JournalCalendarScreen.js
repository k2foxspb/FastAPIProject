import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Calendar } from 'react-native-calendars';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useJournal, useJournalQuery } from '../../context/JournalContext';
import { HeaderButton, JournalGate, Section, SyncBadge, useColors } from '../../components/journal/common';
import ShareButton from '../../components/journal/ShareButton';
import DayCell from '../../components/journal/DayCell';
import { calendarTheme } from '../../components/journal/DateTimeFields';
import { summarizeRange } from '../../journal/db/aggregates';
import { formatDateRu, monthBounds } from '../../journal/utils/dates';
import { formatKop } from '../../journal/utils/money';
import { addWater, guessMealType, listMealTypes } from '../../journal/db/repos/diet';
import { buildMonthCalendarText } from '../../journal/share/summaryText';

const QUICK_ACTIONS = [
  { key: 'finance', icon: 'wallet-outline', label: 'Финансы' },
  { key: 'food', icon: 'restaurant-outline', label: 'Еда' },
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

  const [quickDay, setQuickDay] = useState(null);
  const openDay = useCallback((date) => navigation.navigate('JournalDay', { date: date.dateString }), [navigation]);
  const openQuick = useCallback((date) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    setQuickDay(date.dateString);
  }, []);
  const renderDay = useCallback((props) => <DayCell {...props} colors={colors} onPress={openDay} onLongPress={openQuick} />, [colors, openDay, openQuick]);

  const totals = useMemo(() => {
    const t = { done: 0, total: 0, diary: 0, kcal: 0, income: 0, expense: 0 };
    Object.values(days || {}).forEach((d) => {
      t.done += d.events_done;
      t.total += d.events_total;
      t.diary += d.has_diary ? 1 : 0;
      t.kcal += d.kcal;
      t.income += d.income_kop;
      t.expense += d.expense_kop;
    });
    return { ...t, net: t.income - t.expense };
  }, [days]);

  const todaySummary = days?.[today];

  const runQuick = async (key, date) => {
    if (key === 'expense') navigation.navigate('TransactionEdit', { direction: 'expense', date });
    if (key === 'finance') navigation.navigate('FinanceHome');
    if (key === 'food') {
      Alert.alert('Еда', date, [
        { text: 'Питание', onPress: () => navigation.navigate('DietDay', { date }) },
        {
          text: 'Добавить еду',
          onPress: async () => {
            // Приём пищи по текущему времени - добавление в 2-3 тапа
            const meal = guessMealType(await listMealTypes());
            navigation.navigate('FoodSearch', { date, mealTypeUuid: meal?.uuid || null });
          },
        },
        { text: 'Отмена', style: 'cancel' },
      ]);
    }
    if (key === 'water') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      await addWater(date, 250);
    }
    if (key === 'event') navigation.navigate('EventEdit', { date });
    if (key === 'diary') navigation.navigate('DiaryEdit', { date });
    if (key === 'tracker') navigation.navigate('Trackers', { quickDate: date });
  };

  const onQuick = (key) => runQuick(key, today);

  const onSheetAction = (key) => {
    const date = quickDay;
    setQuickDay(null);
    if (key === 'open') navigation.navigate('JournalDay', { date });
    else runQuick(key, date);
  };

  return (
    <>
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={[styles.calendarWrap, { backgroundColor: 'transparent', borderColor: colors.border }]}>
        <Calendar
          key={`${colors.card}:${settings?.week_start || 1}`}
          current={start}
          firstDay={settings?.week_start === 7 ? 0 : 1}
          markedDates={markedDates}
          dayComponent={renderDay}
          onMonthChange={(m) => setMonth({ year: m.year, month: m.month })}
          enableSwipeMonths
          theme={{ ...calendarTheme(colors), calendarBackground: 'transparent' }}
        />
      </View>

      <View style={styles.quickRow}>
        {QUICK_ACTIONS.map((a) => (
          <TouchableOpacity
            key={a.key}
            style={[styles.quick, { backgroundColor: 'transparent', borderColor: colors.border }]}
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
            {todaySummary?.kcal ? ` · ${todaySummary.kcal} ккал` : ''}
          </Text>
          <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </Section>


      <Section title="За месяц">
        <View style={styles.statsRow}>
          <Stat colors={colors} value={`${totals.done}/${totals.total}`} label="события" onPress={() => navigation.navigate('MonthEvents', { start, end })} />
          <Stat colors={colors} value={String(totals.diary)} label="дней с записями" onPress={() => navigation.navigate('DiaryList')} />
          {totals.kcal > 0 && <Stat colors={colors} value={String(totals.kcal)} label="ккал" onPress={() => navigation.navigate('MonthKcal', { start, end })} />}
          {(totals.income > 0 || totals.expense > 0) && <Stat colors={colors} value={`${totals.net < 0 ? '−' : '+'}${formatKop(Math.abs(totals.net), { withKopecks: false })}`} label="доход − расход" onPress={() => navigation.navigate('ExpenseAnalytics')} />}
        </View>
        <TouchableOpacity style={[styles.analyticsButton, { borderColor: colors.border }]} onPress={() => navigation.navigate('Analytics')}>
          <Icon name="stats-chart-outline" size={18} color={colors.primary} />
          <Text style={[styles.analyticsText, { color: colors.primary }]}>Аналитика</Text>
        </TouchableOpacity>
        <ShareButton
          navigation={navigation}
          label="Поделиться календарём"
          text={buildMonthCalendarText(totals, `Месяц ${String(month.month).padStart(2, '0')}.${month.year}`)}
          style={{ marginHorizontal: 12, marginTop: 8 }}
        />
      </Section>

    </ScrollView>
      <DaySheet
        colors={colors}
        date={quickDay}
        isToday={quickDay === today}
        summary={quickDay ? days?.[quickDay] : null}
        onClose={() => setQuickDay(null)}
        onAction={onSheetAction}
      />
    </>
  );
};

const SHEET_ACTIONS = [
  { key: 'expense', icon: 'remove-circle-outline', label: 'Расход' },
  { key: 'event', icon: 'add-circle-outline', label: 'Событие' },
  { key: 'food', icon: 'restaurant-outline', label: 'Еда' },
  { key: 'water', icon: 'water-outline', label: '+250 мл' },
  { key: 'diary', icon: 'book-outline', label: 'Дневник' },
  { key: 'tracker', icon: 'pulse-outline', label: 'Трекер' },
];

const DaySheet = ({ colors, date, isToday, summary, onClose, onAction }) => {
  const s = summary || {};
  const rows = [
    { icon: 'checkmark-done-outline', label: 'События', value: s.events_total ? `${s.events_done}/${s.events_total}` : 'нет' },
    { icon: 'flame-outline', label: 'Калории', value: s.kcal ? `${s.kcal} ккал` : 'нет' },
    { icon: 'arrow-up-circle-outline', label: 'Доходы', value: s.income_kop ? formatKop(s.income_kop) : 'нет' },
    { icon: 'wallet-outline', label: 'Расходы', value: s.expense_kop ? formatKop(s.expense_kop) : 'нет' },
    { icon: 'swap-vertical-outline', label: 'Разница', value: s.income_kop || s.expense_kop ? formatKop((s.income_kop || 0) - (s.expense_kop || 0)) : 'нет' },
    { icon: 'book-outline', label: 'Дневник', value: s.has_diary ? 'есть запись' : 'нет' },
    { icon: 'pulse-outline', label: 'Трекеры', value: s.tracker_count ? String(s.tracker_count) : 'нет' },
  ];
  return (
    <Modal visible={!!date} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>{date ? formatDateRu(date, { withWeekday: true }) : ''}</Text>
          {isToday && <Text style={[styles.sheetBadge, { color: colors.primary }]}>сегодня</Text>}
        </View>
        {rows.map((r) => (
          <View key={r.label} style={[styles.sheetRow, { borderBottomColor: colors.border }]}>
            <Icon name={r.icon} size={18} color={colors.textSecondary} />
            <Text style={[styles.sheetLabel, { color: colors.textSecondary }]}>{r.label}</Text>
            <Text style={[styles.sheetValue, { color: colors.text }]}>{r.value}</Text>
          </View>
        ))}
        <View style={styles.sheetActions}>
          {SHEET_ACTIONS.map((a) => (
            <TouchableOpacity
              key={a.key}
              style={[styles.quick, { flex: 0, width: '31%', backgroundColor: colors.background, borderColor: colors.border }]}
              onPress={() => onAction(a.key)}
            >
              <Icon name={a.icon} size={20} color={colors.primary} />
              <Text style={[styles.quickText, { color: colors.text }]}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={[styles.openButton, { backgroundColor: colors.primary }]} onPress={() => onAction('open')}>
          <Text style={styles.openButtonText}>Открыть день</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const Stat = ({ colors, value, label, onPress }) => (
  <TouchableOpacity style={styles.stat} onPress={onPress} activeOpacity={0.6}>
    <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
    <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
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
  quick: { flex: 1, marginHorizontal: 3, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', paddingVertical: 12 },
  quickText: { marginTop: 4, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12 },
  rowText: { flex: 1, fontSize: 16 },
  statsRow: { flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 6 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '600' },
  statLabel: { fontSize: 12, marginTop: 2 },
  analyticsButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginHorizontal: 12, marginTop: 8, paddingVertical: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  analyticsText: { fontSize: 15, fontWeight: '600', marginLeft: 6 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { position: 'absolute', left: 12, right: 12, bottom: 24, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sheetTitle: { fontSize: 17, fontWeight: '600' },
  sheetBadge: { fontSize: 12, fontWeight: '600' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetLabel: { flex: 1, marginLeft: 10, fontSize: 14 },
  sheetValue: { fontSize: 14, fontWeight: '600' },
  sheetActions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, marginHorizontal: -3 },
  openButton: { marginTop: 12, borderRadius: 12, alignItems: 'center', paddingVertical: 12 },
  openButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
