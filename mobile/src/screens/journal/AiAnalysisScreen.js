import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { JournalGate, PrimaryButton, Section, useColors } from '../../components/journal/common';
import { useJournal } from '../../context/JournalContext';
import { journalApi, journalAiErrorMessage } from '../../api/journal';
import { addDays, formatDateShort, todayKey } from '../../journal/utils/dates';

const AREA_OPTIONS = [
  { key: 'food', label: 'Питание' },
  { key: 'finance', label: 'Финансы' },
  { key: 'body', label: 'Вес и рост' },
  { key: 'trackers', label: 'Трекеры' },
];

const PERIOD_OPTIONS = [
  { key: 'week', label: '7 дней', days: 7 },
  { key: 'month', label: '30 дней', days: 30 },
];

const Content = () => {
  const colors = useColors();
  const { timezone } = useJournal();
  const [period, setPeriod] = useState('week');
  const [areas, setAreas] = useState(AREA_OPTIONS.map((a) => a.key));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const toggleArea = (key) => {
    setAreas((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const run = async () => {
    if (!areas.length) {
      Alert.alert('Выберите сферы', 'Отметьте хотя бы одну сферу для анализа');
      return;
    }
    const days = PERIOD_OPTIONS.find((p) => p.key === period).days;
    const today = todayKey(timezone);
    setLoading(true);
    try {
      const res = await journalApi.getAnalysis(addDays(today, -(days - 1)), today, areas);
      setResult(res.data);
    } catch (e) {
      Alert.alert('Ошибка', journalAiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const chipStyle = (on) => ({
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: on ? colors.primary : 'transparent',
  });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 40 }}>
      <Section title="Период">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
          {PERIOD_OPTIONS.map((p) => (
            <Text key={p.key} onPress={() => setPeriod(p.key)}
              style={{ ...chipStyle(period === p.key), color: period === p.key ? '#fff' : colors.primary, fontWeight: '600' }}>
              {p.label}
            </Text>
          ))}
        </View>
      </Section>

      <Section title="Сферы">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
          {AREA_OPTIONS.map((a) => (
            <Text key={a.key} onPress={() => toggleArea(a.key)}
              style={{ ...chipStyle(areas.includes(a.key)), color: areas.includes(a.key) ? '#fff' : colors.primary, fontWeight: '600' }}>
              {a.label}
            </Text>
          ))}
        </View>
      </Section>

      <PrimaryButton title={loading ? 'Анализирую...' : 'Запустить анализ'} onPress={run} disabled={loading} />

      {loading && <ActivityIndicator style={{ margin: 16 }} color={colors.primary} />}

      {result && result.message && (
        <Text style={{ color: colors.textSecondary, paddingHorizontal: 16, paddingTop: 16 }}>{result.message}</Text>
      )}

      {result && result.sections.map((s) => (
        <Section key={s.area} title={s.title}>
          <Text style={{ color: colors.text, paddingHorizontal: 16, paddingVertical: 6 }}>{s.summary}</Text>
          {s.recommendations.map((r, i) => (
            <Text key={i} style={{ color: colors.textSecondary, paddingHorizontal: 16, paddingVertical: 4 }}>
              • {r}
            </Text>
          ))}
        </Section>
      ))}

      {result && (
        <Text style={{ color: colors.textSecondary, paddingHorizontal: 16, paddingTop: 12, fontSize: 12 }}>
          Период: {formatDateShort(result.date_from)} - {formatDateShort(result.date_to)}. Советы ИИ не заменяют консультацию врача.
        </Text>
      )}
    </ScrollView>
  );
};

export default function AiAnalysisScreen({ navigation }) {
  return (
    <JournalGate navigation={navigation}>
      <Content />
    </JournalGate>
  );
}
