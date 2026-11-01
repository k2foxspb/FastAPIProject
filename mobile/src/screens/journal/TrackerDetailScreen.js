import React, { useLayoutEffect, useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useJournal, useJournalQuery } from '../../context/JournalContext';
import { Chip, EmptyState, HeaderButton, JournalGate, Section, useColors } from '../../components/journal/common';
import TrackerValueModal from '../../components/journal/TrackerValueModal';
import { deleteTrackerValue, formatTrackerValue, getTracker, listTrackerValues } from '../../journal/db/repos/trackers';
import { addDays, formatDateRu, formatDateShort, formatTime } from '../../journal/utils/dates';

const PERIODS = [
  { days: 30, label: '30 дней' },
  { days: 90, label: '3 месяца' },
  { days: 365, label: 'Год' },
];

const round = (n) => Math.round(n * 100) / 100;

const TrackerDetailContent = ({ navigation, uuid }) => {
  const colors = useColors();
  const { today } = useJournal();
  const { width } = useWindowDimensions();
  const [period, setPeriod] = useState(30);
  const [modal, setModal] = useState(null); // { value } | { value: null }
  const from = addDays(today, -period + 1);

  const { data } = useJournalQuery(async () => {
    const [tracker, values, all] = await Promise.all([
      getTracker(uuid),
      listTrackerValues(uuid, { from, to: today, limit: 2000 }),
      listTrackerValues(uuid, { limit: 200 }),
    ]);
    return { tracker, values, all };
  }, [uuid, from, today]);

  const tracker = data?.tracker;
  const numeric = tracker && tracker.value_type !== 'text';

  // Для графика - одно значение на день (последнее за день), в хронологическом порядке
  const chart = useMemo(() => {
    if (!data || !numeric) return null;
    const byDay = new Map();
    [...data.values].reverse().forEach((v) => {
      if (v.num_value !== null && v.num_value !== undefined) byDay.set(v.value_date, Number(v.num_value));
    });
    const points = [...byDay.entries()];
    if (!points.length) return null;
    const step = Math.max(1, Math.ceil(points.length / 6));
    const series = points.map(([d, value], i) => ({
      value,
      label: i % step === 0 ? formatDateShort(d).slice(0, 5) : '',
      dataPointText: '',
    }));
    const nums = points.map(([, v]) => v);
    const sum = nums.reduce((a, b) => a + b, 0);
    return {
      series,
      min: Math.min(...nums),
      max: Math.max(...nums),
      avg: sum / nums.length,
      last: nums[nums.length - 1],
      first: nums[0],
      count: nums.length,
    };
  }, [data, numeric]);

  if (!data) return null;
  if (!tracker) {
    return <EmptyState icon="alert-circle-outline" title="Трекер не найден" />;
  }

  const color = tracker.color || colors.primary;
  const format = (n) => formatTrackerValue(tracker, { num_value: n });
  const isBool = tracker.value_type === 'bool';
  const boolDone = isBool ? data.values.filter((v) => Number(v.num_value) === 1).length : 0;

  const valueMenu = (value) => {
    Alert.alert(formatDateRu(value.value_date), formatTrackerValue(tracker, value), [
      { text: 'Изменить', onPress: () => setModal({ value }) },
      { text: 'Удалить', style: 'destructive', onPress: () => deleteTrackerValue(value.uuid) },
      { text: 'Отмена', style: 'cancel' },
    ]);
  };

  const header = (
    <View>
      <View style={styles.periods}>
        {PERIODS.map((p) => <Chip key={p.days} label={p.label} selected={period === p.days} onPress={() => setPeriod(p.days)} />)}
      </View>
      {numeric && !isBool && chart && chart.count > 1 && (
        <View style={[styles.chartBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <LineChart
            data={chart.series}
            width={width - 90}
            height={180}
            color={color}
            thickness={2}
            curved
            areaChart
            startFillColor={color}
            endFillColor={color}
            startOpacity={0.25}
            endOpacity={0.02}
            hideDataPoints={chart.count > 40}
            dataPointsColor={color}
            adjustToWidth
            initialSpacing={8}
            noOfSections={4}
            yAxisOffset={tracker.value_type === 'number' ? Math.floor(chart.min * 0.95) : 0}
            rulesColor={colors.border}
            yAxisColor={colors.border}
            xAxisColor={colors.border}
            yAxisTextStyle={{ color: colors.textSecondary, fontSize: 10 }}
            xAxisLabelTextStyle={{ color: colors.textSecondary, fontSize: 9, width: 40 }}
            showReferenceLine1={tracker.goal_value !== null && tracker.goal_value !== undefined}
            referenceLine1Position={tracker.goal_value !== null && tracker.goal_value !== undefined
              ? Number(tracker.goal_value) - (tracker.value_type === 'number' ? Math.floor(chart.min * 0.95) : 0) : 0}
            referenceLine1Config={{ color: colors.success, dashWidth: 4, dashGap: 4 }}
          />
        </View>
      )}
      <Section title="Сводка за период">
        <View style={styles.stats}>
          {isBool ? (
            <>
              <Stat colors={colors} label="выполнено" value={`${boolDone} дн.`} />
              <Stat colors={colors} label="из периода" value={`${Math.round((boolDone / period) * 100)}%`} />
            </>
          ) : chart ? (
            <>
              <Stat colors={colors} label="последнее" value={format(chart.last)} />
              <Stat colors={colors} label="среднее" value={format(round(chart.avg))} />
              <Stat colors={colors} label="мин / макс" value={`${round(chart.min)} / ${round(chart.max)}`} />
            </>
          ) : (
            <Text style={{ color: colors.textSecondary, padding: 8 }}>Нет значений за период</Text>
          )}
        </View>
        {!isBool && chart && chart.count > 1 && tracker.value_type === 'number' && (
          <Text style={[styles.delta, { color: colors.textSecondary }]}>
            Изменение: {chart.last - chart.first > 0 ? '+' : ''}{String(round(chart.last - chart.first)).replace('.', ',')}{tracker.unit ? ` ${tracker.unit}` : ''}
          </Text>
        )}
        {tracker.goal_value !== null && tracker.goal_value !== undefined && (
          <Text style={[styles.delta, { color: colors.textSecondary }]}>
            Цель: {tracker.goal_direction === 'not_exceed' ? 'не больше ' : ''}{format(tracker.goal_value)}
          </Text>
        )}
      </Section>
      <Text style={[styles.historyTitle, { color: colors.textSecondary }]}>История</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={data.all}
        keyExtractor={(v) => v.uuid}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.valueRow, { backgroundColor: colors.card }]} onPress={() => valueMenu(item)}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 15 }}>
                {formatDateRu(item.value_date, { withYear: false })}{item.value_time ? `, ${formatTime(item.value_time)}` : ''}
              </Text>
              {!!item.note && <Text style={{ color: colors.textSecondary, fontSize: 13 }} numberOfLines={1}>{item.note}</Text>}
            </View>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{formatTrackerValue(tracker, item)}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<EmptyState icon="pulse-outline" title="Значений пока нет" subtitle="Нажмите «+», чтобы добавить первое" />}
        contentContainerStyle={{ paddingBottom: 96 }}
        initialNumToRender={15}
      />
      <TouchableOpacity style={[styles.fab, { backgroundColor: color }]} onPress={() => setModal({ value: null })}>
        <Icon name="add" size={28} color="#fff" />
      </TouchableOpacity>
      <TrackerValueModal visible={!!modal} tracker={tracker} value={modal?.value} date={today} onClose={() => setModal(null)} />
    </View>
  );
};

const Stat = ({ colors, label, value }) => (
  <View style={styles.stat}>
    <Text style={[styles.statValue, { color: colors.text }]} numberOfLines={1}>{value}</Text>
    <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
  </View>
);

export default function TrackerDetailScreen({ navigation, route }) {
  const uuid = route.params?.uuid;
  const { data: tracker } = useJournalQuery(() => getTracker(uuid), [uuid]);
  useLayoutEffect(() => {
    navigation.setOptions({
      title: tracker?.name || 'Трекер',
      headerRight: () => <HeaderButton icon="create-outline" onPress={() => navigation.navigate('TrackerEdit', { uuid })} />,
    });
  }, [navigation, tracker, uuid]);
  return (
    <JournalGate navigation={navigation}>
      <TrackerDetailContent navigation={navigation} uuid={uuid} />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  periods: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 12 },
  chartBox: { marginHorizontal: 12, marginTop: 4, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 12, overflow: 'hidden' },
  stats: { flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 6 },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  statValue: { fontSize: 16, fontWeight: '600' },
  statLabel: { fontSize: 12, marginTop: 2 },
  delta: { fontSize: 13, paddingHorizontal: 12, paddingBottom: 4 },
  historyTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginTop: 16, marginBottom: 6, marginHorizontal: 16 },
  valueRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 6, borderRadius: 10, padding: 12 },
  fab: { position: 'absolute', right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', elevation: 4 },
});
