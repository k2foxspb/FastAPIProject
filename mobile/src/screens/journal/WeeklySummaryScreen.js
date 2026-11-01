import React, { useCallback, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { JournalGate, PrimaryButton, Section, useColors } from '../../components/journal/common';
import { buildPeriodAnalytics } from '../../journal/db/repos/analytics';
import { formatKop } from '../../journal/utils/money';
import { addDays, formatDateShort, todayKey } from '../../journal/utils/dates';
import { useJournal } from '../../context/JournalContext';
import { buildPeriodText } from '../../journal/share/summaryText';
import ShareButton from '../../components/journal/ShareButton';

const Content = ({ navigation }) => {
  const colors = useColors();
  const { timezone } = useJournal();
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    const today = todayKey(timezone);
    setData(await buildPeriodAnalytics(addDays(today, -6), today));
  }, [timezone]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!data) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  const { nutritionAverages: avg, goals, expenseTotalKop } = data;
  const daysWithFood = data.nutrition.filter((d) => d.kcal > 0).length;
  const kcalGoal = goals.nutrition.kcal;
  const kcalDelta = kcalGoal ? avg.kcal - kcalGoal : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={{ color: colors.textSecondary, paddingHorizontal: 16, paddingTop: 12 }}>
        Неделя: {formatDateShort(data.start)} - {formatDateShort(data.end)}
      </Text>

      <Section title="Питание">
        <Text style={{ color: colors.text, paddingHorizontal: 16, paddingVertical: 6 }}>
          Дней с записями о еде: {daysWithFood} из 7
        </Text>
        <Text style={{ color: colors.text, paddingHorizontal: 16, paddingVertical: 6 }}>
          Среднее: {avg.kcal} ккал
          {kcalGoal ? ` (цель ${kcalGoal}, ${kcalDelta >= 0 ? '+' : ''}${Math.round(kcalDelta)})` : ''}
        </Text>
        <Text style={{ color: colors.textSecondary, paddingHorizontal: 16, paddingVertical: 6 }}>
          Б {avg.protein} г · Ж {avg.fat} г · У {avg.carbs} г
        </Text>
      </Section>

      <Section title="Расходы">
        <Text style={{ color: colors.text, paddingHorizontal: 16, paddingVertical: 6 }}>
          Всего за неделю: {formatKop(expenseTotalKop)}
        </Text>
        {data.expenseCategories.slice(0, 3).map((c) => (
          <Text key={c.name} style={{ color: colors.textSecondary, paddingHorizontal: 16, paddingVertical: 4 }}>
            {c.name}: {formatKop(c.amount_kop)}
          </Text>
        ))}
      </Section>

      <Section title="Трекеры">
        {data.trackers.length === 0 && (
          <Text style={{ color: colors.textSecondary, paddingHorizontal: 16, paddingVertical: 6 }}>Нет значений за неделю</Text>
        )}
        {data.trackers.map((t) => (
          <TouchableOpacity
            key={t.uuid}
            onPress={() => navigation.navigate('TrackerDetail', { uuid: t.uuid })}
            style={{ paddingHorizontal: 16, paddingVertical: 8 }}
          >
            <Text style={{ color: colors.text, fontWeight: '600' }}>{t.name}</Text>
            <Text style={{ color: colors.textSecondary, marginTop: 2 }}>
              {t.first} → {t.last}{t.tracker?.unit ? ` ${t.tracker.unit}` : ''} · записей {t.count}
            </Text>
          </TouchableOpacity>
        ))}
      </Section>

      <PrimaryButton title="Подробная аналитика" onPress={() => navigation.navigate('Analytics')} />
      <PrimaryButton title="Экспорт" onPress={() => navigation.navigate('Export')} style={{ marginTop: 10 }} />
      <ShareButton navigation={navigation} label="Отправить в сообщения" text={buildPeriodText(data, 'week')} style={{ marginTop: 10 }} />
    </ScrollView>
  );
};

export default function WeeklySummaryScreen({ navigation }) {
  return (
    <JournalGate navigation={navigation}>
      <Content navigation={navigation} />
    </JournalGate>
  );
}
