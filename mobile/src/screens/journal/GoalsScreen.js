import React, { useCallback, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useJournal } from '../../context/JournalContext';
import { EmptyState, JournalGate, Section, useColors } from '../../components/journal/common';
import { listTrackers, listTrackerValues, formatTrackerValue } from '../../journal/db/repos/trackers';

const NUTRITION_GOALS = [
  { key: 'kcal_goal', label: 'Калории', unit: 'ккал' },
  { key: 'protein_g_goal', label: 'Белки', unit: 'г' },
  { key: 'fat_g_goal', label: 'Жиры', unit: 'г' },
  { key: 'carbs_g_goal', label: 'Углеводы', unit: 'г' },
  { key: 'water_ml_goal', label: 'Вода', unit: 'мл' },
];

const DIRECTION_LABELS = { reach: 'Не ниже', not_exceed: 'Не выше' };

const Content = ({ navigation }) => {
  const colors = useColors();
  const { settings } = useJournal();
  const [trackers, setTrackers] = useState([]);

  const load = useCallback(async () => {
    const list = (await listTrackers()).filter((t) => t.goal_value !== null && t.goal_value !== undefined);
    const withValues = await Promise.all(list.map(async (t) => {
      const [last] = await listTrackerValues(t.uuid, { limit: 1 });
      return { ...t, last };
    }));
    setTrackers(withValues);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const nutrition = NUTRITION_GOALS.filter((g) => settings?.[g.key]);
  const hasAny = nutrition.length > 0 || trackers.length > 0;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 40 }}>
      {!hasAny && (
        <EmptyState
          icon="flag-outline"
          title="Целей пока нет"
          subtitle="Задайте цель для трекера (например, вес) или цели питания"
        />
      )}
      {trackers.length > 0 && (
        <Section title="Трекеры">
          {trackers.map((t) => (
            <TouchableOpacity
              key={t.uuid}
              onPress={() => navigation.navigate('GoalEdit', { trackerUuid: t.uuid })}
              style={{ paddingHorizontal: 16, paddingVertical: 12 }}
            >
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{t.name}</Text>
              <Text style={{ color: colors.textSecondary, marginTop: 4 }}>
                {DIRECTION_LABELS[t.goal_direction] || 'Цель'}: {formatTrackerValue(t, { num_value: t.goal_value })}
                {'  ·  '}Сейчас: {formatTrackerValue(t, t.last)}
              </Text>
            </TouchableOpacity>
          ))}
        </Section>
      )}
      {nutrition.length > 0 && (
        <Section title="Питание (в день)">
          {nutrition.map((g) => (
            <View key={g.key} style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
              <Text style={{ color: colors.text, fontSize: 15 }}>
                {g.label}: {settings[g.key]} {g.unit}
              </Text>
            </View>
          ))}
        </Section>
      )}
      <TouchableOpacity
        onPress={() => navigation.navigate('GoalEdit', {})}
        style={{ margin: 16, padding: 14, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center' }}
      >
        <Text style={{ color: '#fff', fontWeight: '600' }}>Добавить цель</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => navigation.navigate('NutritionGoals')}
        style={{ marginHorizontal: 16, marginBottom: 16, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.primary, alignItems: 'center' }}
      >
        <Text style={{ color: colors.primary, fontWeight: '600' }}>Цели питания (КБЖУ и вода)</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

export default function GoalsScreen({ navigation }) {
  return (
    <JournalGate navigation={navigation}>
      <Content navigation={navigation} />
    </JournalGate>
  );
}
