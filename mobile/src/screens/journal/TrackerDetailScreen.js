import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BarChart, LineChart } from 'react-native-gifted-charts';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useJournal, useJournalQuery } from '../../context/JournalContext';
import { Chip, EmptyState, HeaderButton, JournalGate, Section, useColors } from '../../components/journal/common';
import {
  deleteTracker, formatTrackerValue, getTracker, listTrackerDailyValues, listTrackerDayStats, listTrackerValues, listTrackerValuesInRange,
} from '../../journal/db/repos/trackers';
import { addDays, formatDateRu, formatDateShort, formatTime } from '../../journal/utils/dates';

const PERIODS = [
  { days: 30, label: '30 дней' },
  { days: 90, label: '3 месяца' },
  { days: 365, label: 'Год' },
];

const MINUTE_KIND = 'minute';
const HOUR_KIND = 'hours';
const BAR_KIND = 'bars';
const LINE_KIND = 'line';

const CHART_HINTS = {
  [MINUTE_KIND]: 'Замеры по минутам, прокрутка влево-вправо',
  [HOUR_KIND]: 'Длительность сна в часах по дням',
  [BAR_KIND]: 'Количество шагов по дням',
  [LINE_KIND]: '',
};

const round = (n) => Math.round(n * 100) / 100;

// Для пульса: размер интервала агрегации (мин) по периоду; 1 - поминутно
const PULSE_BUCKET_MINUTES = { 30: 30, 90: 60, 365: 120 };

const bucketOf = (kind, period) => (kind === MINUTE_KIND ? PULSE_BUCKET_MINUTES[period] || 1 : 1);

const chartHintOf = (kind, period) => (bucketOf(kind, period) > 1
  ? `Средние значения за интервалы по ${bucketOf(kind, period)} мин, прокрутка влево-вправо`
  : CHART_HINTS[kind]);

const minutesOf = (time) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

const hhmm = (total) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

// Агрегирует минутные замеры в интервалы заданной длины (среднее за интервал)
const aggregateByInterval = (rows, bucketMinutes) => {
  const buckets = new Map();
  for (const r of rows) {
    const slot = r.value_time ? Math.floor(minutesOf(r.value_time) / bucketMinutes) * bucketMinutes : null;
    const key = `${r.value_date}|${slot}`;
    const bucket = buckets.get(key) || { value_date: r.value_date, value_time: slot === null ? null : hhmm(slot), sum: 0, n: 0 };
    bucket.sum += Number(r.num_value);
    bucket.n += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map((b) => ({ value_date: b.value_date, value_time: b.value_time, num_value: b.sum / b.n }));
};

const chartKindOf = (tracker) => {
  if (tracker.template_key === 'pulse') return MINUTE_KIND;
  if (tracker.template_key === 'sleep') return HOUR_KIND;
  if (tracker.template_key === 'steps') return BAR_KIND;
  return LINE_KIND;
};

const timeLabel = (time) => (time ? formatTime(time) : '');

const pointLabel = (kind, value, prev) => {
  if (kind === MINUTE_KIND) {
    const dayChanged = !prev || prev.value_date !== value.value_date;
    const time = timeLabel(value.value_time);
    return dayChanged ? `${formatDateShort(value.value_date).slice(0, 5)} ${time}`.trim() : time;
  }
  return formatDateShort(value.value_date).slice(0, 5);
};

const Y_AXIS_WIDTH = 48;

// Прокручиваемый график: масштаб задаётся периодом, по ширине растягивается под количество точек
// Шкала Y выводится отдельным неподвижным графиком слева, поэтому всегда видна при прокрутке
const TrackerChart = ({ kind, points, colors, color, viewWidth, height, goal, yOffset }) => {
  const scrollRef = useRef(null);
  const count = points.length;
  const isBars = kind === BAR_KIND;
  const minSpacing = isBars ? 16 : kind === MINUTE_KIND ? 8 : 12;
  const fitSpacing = Math.floor((viewWidth - 60) / Math.max(count - 1, 1));
  const spacing = Math.max(minSpacing, fitSpacing);
  const contentWidth = spacing * Math.max(count - 1, 1) + 60;
  const labelEvery = Math.max(1, Math.ceil(count / Math.max(1, Math.floor(contentWidth / 64))));
  let lastLabel = -Infinity;
  const data = points.map((p, i) => {
    const gap = i - lastLabel;
    const show = p.dayStart ? gap >= Math.ceil(labelEvery / 2) : i % labelEvery === 0 && gap >= Math.ceil(labelEvery / 2);
    if (show) lastLabel = i;
    return {
      value: p.value,
      label: show ? p.label : '',
      dataPointText: '',
      frontColor: color,
    };
  });
  const axis = {
    height,
    width: contentWidth,
    spacing,
    initialSpacing: 20,
    endSpacing: 20,
    noOfSections: 4,
    yAxisColor: colors.border,
    xAxisColor: colors.border,
    rulesColor: colors.border,
    yAxisTextStyle: { color: colors.textSecondary, fontSize: 10 },
    xAxisLabelTextStyle: { color: colors.textSecondary, fontSize: 9, width: 56 },
  };
  const hasGoal = goal !== null && goal !== undefined;
  const yAxisOnly = (
    <LineChart
      height={height}
      width={Y_AXIS_WIDTH}
      data={data.map((d) => ({ ...d, label: '' }))}
      spacing={0}
      initialSpacing={0}
      endSpacing={0}
      noOfSections={4}
      hideRules
      hideDataPoints
      thickness={0}
      color="transparent"
      xAxisThickness={0}
      yAxisColor={colors.border}
      yAxisTextStyle={{ color: colors.textSecondary, fontSize: 10 }}
      yAxisOffset={yOffset}
      yAxisLabelSuffix={kind === HOUR_KIND ? ' ч' : ''}
    />
  );
  return (
    <View style={{ flexDirection: 'row' }}>
      <View style={{ width: Y_AXIS_WIDTH, overflow: 'hidden' }}>{yAxisOnly}</View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {isBars ? (
          <BarChart
            {...axis}
            hideYAxisText
            yAxisThickness={0}
            data={data}
            barWidth={Math.max(6, Math.floor(spacing * 0.6))}
            barBorderRadius={4}
            frontColor={color}
          />
        ) : (
          <LineChart
            {...axis}
            hideYAxisText
            yAxisThickness={0}
            data={data}
            color={color}
            thickness={2}
            curved={kind !== MINUTE_KIND}
            areaChart
            startFillColor={color}
            endFillColor={color}
            startOpacity={0.25}
            endOpacity={0.02}
            hideDataPoints={count > 40}
            dataPointsColor={color}
            yAxisOffset={yOffset}
            showReferenceLine1={hasGoal}
            referenceLine1Position={hasGoal ? Number(goal) - yOffset : 0}
            referenceLine1Config={{ color: colors.success, dashWidth: 4, dashGap: 4 }}
          />
        )}
      </ScrollView>
    </View>
  );
};

const TrackerDetailContent = ({ navigation, uuid }) => {
  const colors = useColors();
  const { today } = useJournal();
  const { width, height: windowHeight } = useWindowDimensions();
  const [period, setPeriod] = useState(30);
  const [fullscreen, setFullscreen] = useState(false);
  const from = addDays(today, -period + 1);

  const { data } = useJournalQuery(async () => {
    const tracker = await getTracker(uuid);
    const range = { from, to: today };
    const isPulse = tracker?.template_key === 'pulse';
    const [daily, all, raw, dayStats] = await Promise.all([
      listTrackerDailyValues(uuid, range),
      listTrackerValues(uuid, { limit: 200 }),
      isPulse ? listTrackerValuesInRange(uuid, range) : Promise.resolve([]),
      isPulse ? listTrackerDayStats(uuid, range) : Promise.resolve([]),
    ]);
    return { tracker, daily, all, raw, dayStats };
  }, [uuid, from, today]);

  const tracker = data?.tracker;
  const numeric = tracker && tracker.value_type !== 'text';
  const kind = tracker ? chartKindOf(tracker) : LINE_KIND;
  const isPulse = kind === MINUTE_KIND;

  // Для графика: точки в нужных единицах и статистика в исходных единицах трекера
  const chart = useMemo(() => {
    if (!data || !numeric) return null;
    const raw = kind === MINUTE_KIND ? data.raw : data.daily;
    const bucket = bucketOf(kind, period);
    const source = bucket > 1 ? aggregateByInterval(raw, bucket) : raw;
    if (!source.length) return null;
    const values = source.map((v) => Number(v.num_value));
    const statValues = raw.map((v) => Number(v.num_value));
    const points = source.map((v, i) => ({
      value: kind === HOUR_KIND ? values[i] / 60 : values[i],
      label: pointLabel(kind, v, source[i - 1]),
      dayStart: kind === MINUTE_KIND && (!source[i - 1] || source[i - 1].value_date !== v.value_date),
    }));
    const sum = statValues.reduce((a, b) => a + b, 0);
    return {
      points,
      min: Math.min(...statValues),
      max: Math.max(...statValues),
      avg: sum / statValues.length,
      last: statValues[statValues.length - 1],
      first: statValues[0],
      count: statValues.length,
    };
  }, [data, numeric, kind, period]);

  if (!data) return null;
  if (!tracker) {
    return <EmptyState icon="alert-circle-outline" title="Трекер не найден" />;
  }

  const color = tracker.color || colors.primary;
  const format = (n) => formatTrackerValue(tracker, { num_value: n });
  const isBool = tracker.value_type === 'bool';
  const boolDone = isBool ? data.daily.filter((v) => Number(v.num_value) === 1).length : 0;
  const hasGoalValue = tracker.goal_value !== null && tracker.goal_value !== undefined;
  const goal = hasGoalValue ? (kind === HOUR_KIND ? Number(tracker.goal_value) / 60 : Number(tracker.goal_value)) : null;
  const yOffset = kind === BAR_KIND || kind === HOUR_KIND || !chart || tracker.value_type !== 'number'
    ? 0 : Math.floor(chart.min * 0.95);
  const canChart = numeric && !isBool && chart && chart.count > 1;

  const renderChart = (viewWidth, height) => (
    <TrackerChart
      kind={kind}
      points={chart.points}
      colors={colors}
      color={color}
      viewWidth={viewWidth}
      height={height}
      goal={goal}
      yOffset={yOffset}
    />
  );

  const periodChips = PERIODS.map((p) => (
    <Chip key={p.days} label={p.label} selected={period === p.days} onPress={() => setPeriod(p.days)} />
  ));

  const header = (
    <View>
      <View style={styles.periods}>{periodChips}</View>
      {canChart && (
        <View style={[styles.chartBox, { backgroundColor: 'transparent', borderColor: colors.border }]}>
          <View style={styles.chartHeader}>
            <Text style={[styles.chartHint, { color: colors.textSecondary }]} numberOfLines={1}>{chartHintOf(kind, period)}</Text>
            <Pressable onPress={() => setFullscreen(true)} hitSlop={10}>
              <Icon name="expand-outline" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          {renderChart(width - 90, 180)}
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
        {hasGoalValue && (
          <Text style={[styles.delta, { color: colors.textSecondary }]}>
            Цель: {tracker.goal_direction === 'not_exceed' ? 'не больше ' : ''}{format(tracker.goal_value)}
          </Text>
        )}
      </Section>
      <Text style={[styles.historyTitle, { color: colors.textSecondary }]}>{isPulse ? 'История по дням' : 'История'}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={isPulse ? data.dayStats : data.all}
        keyExtractor={(v) => v.uuid ?? v.value_date}
        ListHeaderComponent={header}
        renderItem={({ item }) => (isPulse ? (
          <View style={[styles.valueRow, { backgroundColor: 'transparent' }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 15 }}>{formatDateRu(item.value_date, { withYear: false })}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                мин {round(item.min_value)} · макс {round(item.max_value)} · замеров {item.cnt}
              </Text>
            </View>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{format(round(item.avg_value))}</Text>
          </View>
        ) : (
          <View style={[styles.valueRow, { backgroundColor: 'transparent' }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 15 }}>
                {formatDateRu(item.value_date, { withYear: false })}{item.value_time ? `, ${formatTime(item.value_time)}` : ''}
              </Text>
              {!!item.note && <Text style={{ color: colors.textSecondary, fontSize: 13 }} numberOfLines={1}>{item.note}</Text>}
            </View>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{formatTrackerValue(tracker, item)}</Text>
          </View>
        ))}
        ListEmptyComponent={<EmptyState icon="pulse-outline" title="Значений пока нет" subtitle="Значения импортируются из приложения «Здоровье»" />}
        contentContainerStyle={{ paddingBottom: 32 }}
        initialNumToRender={15}
      />
      <Modal visible={fullscreen} animationType="slide" onRequestClose={() => setFullscreen(false)}>
        <View style={[styles.fullscreen, { backgroundColor: colors.background }]}>
          <View style={styles.fullHeader}>
            <Text style={[styles.fullTitle, { color: colors.text }]} numberOfLines={1}>{tracker.name}</Text>
            <Pressable onPress={() => setFullscreen(false)} hitSlop={10}>
              <Icon name="close" size={26} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.periods}>{periodChips}</View>
          {canChart && (
            <View style={styles.fullChart}>
              <Text style={[styles.chartHint, { color: colors.textSecondary, marginBottom: 8 }]}>{chartHintOf(kind, period)}</Text>
              {renderChart(width - 40, windowHeight - 240)}
            </View>
          )}
        </View>
      </Modal>
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
  const colors = useColors();
  const { data: tracker } = useJournalQuery(() => getTracker(uuid), [uuid]);
  const remove = () => {
    Alert.alert('Удалить трекер?', 'Трекер и все его значения будут удалены.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          await deleteTracker(uuid);
          navigation.goBack();
        },
      },
    ]);
  };
  useLayoutEffect(() => {
    navigation.setOptions({
      title: tracker?.name || 'Трекер',
      headerRight: () => (tracker ? <HeaderButton icon="trash-outline" color={colors.error} onPress={remove} /> : null),
    });
  }, [navigation, tracker, colors]);
  return (
    <JournalGate navigation={navigation}>
      <TrackerDetailContent navigation={navigation} uuid={uuid} />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  periods: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 12 },
  chartBox: { marginHorizontal: 12, marginTop: 4, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 12, paddingHorizontal: 8, overflow: 'hidden' },
  chartHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, paddingHorizontal: 4 },
  chartHint: { fontSize: 12, flex: 1, marginRight: 8 },
  fullscreen: { flex: 1, paddingTop: 48 },
  fullHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  fullTitle: { fontSize: 18, fontWeight: '600', flex: 1, marginRight: 12 },
  fullChart: { marginHorizontal: 12, marginTop: 12 },
  stats: { flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 6 },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  statValue: { fontSize: 16, fontWeight: '600' },
  statLabel: { fontSize: 12, marginTop: 2 },
  delta: { fontSize: 13, paddingHorizontal: 12, paddingBottom: 4 },
  historyTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginTop: 16, marginBottom: 6, marginHorizontal: 16 },
  valueRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 6, borderRadius: 10, padding: 12 },
});
