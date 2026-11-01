import React, { useCallback, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Chip, JournalGate, Section, useColors } from '../../components/journal/common';
import { buildPeriodAnalytics } from '../../journal/db/repos/analytics';
import { formatKop } from '../../journal/utils/money';
import { addDays, monthBounds, todayKey, parseDateKey, formatDateShort } from '../../journal/utils/dates';
import { useJournal } from '../../context/JournalContext';

const PERIODS = [
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
];

// Период: неделя - 7 дней, заканчивающихся сегодня; месяц - текущий календарный месяц
const periodBounds = (period, tz) => {
  const today = todayKey(tz);
  if (period === 'week') return [addDays(today, -6), today];
  const d = parseDateKey(today);
  return monthBounds(d.getUTCFullYear(), d.getUTCMonth() + 1);
};

const Stat = ({ label, value }) => {
  const colors = useColors();
  return (
    <View style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 12 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600', marginTop: 2 }}>{value}</Text>
    </View>
  );
};

const Content = ({ navigation }) => {
  const colors = useColors();
  const { timezone } = useJournal();
  const [period, setPeriod] = useState('week');
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    const [start, end] = periodBounds(period, timezone);
    setData(await buildPeriodAnalytics(start, end));
  }, [period, timezone]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!data) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  const { nutritionAverages: avg, goals } = data;
  const topCategories = data.expenseCategories.slice(0, 5);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingTop: 12, gap: 8 }}>
        {PERIODS.map((p) => (
          <Chip key={p.key} label={p.label} selected={period === p.key} onPress={() => setPeriod(p.key)} />
        ))}
      </View>
      <Text style={{ color: colors.textSecondary, paddingHorizontal: 16, paddingTop: 8 }}>
        {formatDateShort(data.start)} - {formatDateShort(data.end)}
      </Text>

      <Section title="КБЖУ (среднее в дни с записями)">
        <Text style={{ color: colors.textSecondary, paddingHorizontal: 16, fontSize: 13 }}>
          Дней с записями: {avg.loggedDays}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Stat label="Калории, ккал" value={`${avg.kcal}${goals.nutrition.kcal ? ` / ${goals.nutrition.kcal}` : ''}`} />
          <Stat label="Белки, г" value={`${avg.protein}${goals.nutrition.protein ? ` / ${goals.nutrition.protein}` : ''}`} />
          <Stat label="Жиры, г" value={`${avg.fat}${goals.nutrition.fat ? ` / ${goals.nutrition.fat}` : ''}`} />
          <Stat label="Углеводы, г" value={`${avg.carbs}${goals.nutrition.carbs ? ` / ${goals.nutrition.carbs}` : ''}`} />
        </View>
      </Section>

      <Section title="Расходы">
        <Stat label="Всего за период" value={formatKop(data.expenseTotalKop)} />
        {topCategories.map((c) => (
          <View key={c.name} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 6 }}>
            <Text style={{ color: colors.text }}>{c.name}</Text>
            <Text style={{ color: colors.text }}>{formatKop(c.amount_kop)}</Text>
          </View>
        ))}
      </Section>

      <Section title="Трекеры">
        {data.trackers.length === 0 && (
          <Text style={{ color: colors.textSecondary, paddingHorizontal: 16 }}>Нет значений за период</Text>
        )}
        {data.trackers.map((t) => (
          <TouchableOpacity
            key={t.uuid}
            onPress={() => navigation.navigate('TrackerDetail', { uuid: t.uuid })}
            style={{ paddingHorizontal: 16, paddingVertical: 10 }}
          >
            <Text style={{ color: colors.text, fontWeight: '600' }}>{t.name}</Text>
            <Text style={{ color: colors.textSecondary, marginTop: 2 }}>
              Было {t.first} → стало {t.last} (мин {t.min}, макс {t.max}, среднее {t.avg}) · записей {t.count}
            </Text>
          </TouchableOpacity>
        ))}
      </Section>
    </ScrollView>
  );
};

export default function AnalyticsScreen({ navigation }) {
  return (
    <JournalGate navigation={navigation}>
      <Content navigation={navigation} />
    </JournalGate>
  );
}
