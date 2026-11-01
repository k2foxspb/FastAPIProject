import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Chip, JournalGate, PrimaryButton, Section, useColors } from '../../components/journal/common';
import { buildPeriodAnalytics, trackerSeries } from '../../journal/db/repos/analytics';
import { listTransactions } from '../../journal/db/repos/finance';
import { addDays, monthBounds, todayKey, parseDateKey } from '../../journal/utils/dates';
import {
  buildExpensesCsv, buildNutritionCsv, buildWeightCsv, buildReportHtml, shareCsv, sharePdf,
} from '../../journal/utils/export';
import { useJournal } from '../../context/JournalContext';

const PERIODS = [
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
];

const periodBounds = (period, tz) => {
  const today = todayKey(tz);
  if (period === 'week') return [addDays(today, -6), today];
  const d = parseDateKey(today);
  return monthBounds(d.getUTCFullYear(), d.getUTCMonth() + 1);
};

const Content = () => {
  const colors = useColors();
  const { timezone } = useJournal();
  const [period, setPeriod] = useState('week');
  const [busy, setBusy] = useState(false);

  const run = async (task) => {
    setBusy(true);
    try {
      await task();
    } catch (e) {
      Alert.alert('Не удалось экспортировать', e?.message || '');
    } finally {
      setBusy(false);
    }
  };

  const [start, end] = periodBounds(period, timezone);
  const suffix = `${start}_${end}`;

  const exportExpenses = () => run(async () => {
    const transactions = await listTransactions({ from: start, to: end, limit: 100000 });
    await shareCsv(`expenses_${suffix}.csv`, buildExpensesCsv(transactions));
  });

  const exportNutrition = () => run(async () => {
    const data = await buildPeriodAnalytics(start, end);
    await shareCsv(`nutrition_${suffix}.csv`, buildNutritionCsv(data.nutrition));
  });

  const exportWeight = () => run(async () => {
    const trackers = await trackerSeries(start, end);
    const weight = trackers.find((t) => t.tracker?.template_key === 'weight');
    if (!weight) throw new Error('Трекер «Вес» не найден или нет значений за период');
    await shareCsv(`weight_${suffix}.csv`, buildWeightCsv(weight.points));
  });

  const exportPdf = () => run(async () => {
    const data = await buildPeriodAnalytics(start, end);
    const html = buildReportHtml({
      title: 'Отчёт журнала',
      period: `${start} - ${end}`,
      nutritionAverages: data.nutritionAverages,
      expenseTotalKop: data.expenseTotalKop,
      expenseCategories: data.expenseCategories,
      trackers: data.trackers,
    });
    await sharePdf(html);
  });

  const Action = ({ title, onPress }) => (
    <PrimaryButton title={title} onPress={onPress} loading={busy} disabled={busy} style={{ marginHorizontal: 16, marginTop: 10 }} />
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingTop: 12, gap: 8 }}>
        {PERIODS.map((p) => (
          <Chip key={p.key} label={p.label} selected={period === p.key} onPress={() => setPeriod(p.key)} />
        ))}
      </View>
      <Text style={{ color: colors.textSecondary, paddingHorizontal: 16, paddingTop: 8 }}>
        Период: {start} - {end}
      </Text>
      <Section title="CSV (открывается в Excel и Google Sheets)">
        <Action title="Расходы (CSV)" onPress={exportExpenses} />
        <Action title="КБЖУ по дням (CSV)" onPress={exportNutrition} />
        <Action title="Вес (CSV)" onPress={exportWeight} />
      </Section>
      <Section title="PDF">
        <Action title="Отчёт за период (PDF)" onPress={exportPdf} />
      </Section>
      <Text style={{ color: colors.textSecondary, paddingHorizontal: 16, fontSize: 12 }}>
        Значения, начинающиеся с =, +, - или @, экранируются в CSV, чтобы их не приняли за формулы.
      </Text>
    </ScrollView>
  );
};

export default function ExportScreen({ navigation }) {
  return (
    <JournalGate navigation={navigation}>
      <Content />
    </JournalGate>
  );
}
