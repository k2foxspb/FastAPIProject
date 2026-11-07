import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Chip, Field, Input, JournalGate, PrimaryButton, Section, useColors } from '../../components/journal/common';
import { listTrackers, getTracker, saveTracker } from '../../journal/db/repos/trackers';

const DIRECTIONS = [
  { key: 'not_exceed', label: 'Не выше' },
  { key: 'reach', label: 'Не ниже' },
];

const Content = ({ navigation, route }) => {
  const colors = useColors();
  const initialUuid = route?.params?.trackerUuid || null;
  const [trackers, setTrackers] = useState([]);
  const [trackerUuid, setTrackerUuid] = useState(initialUuid);
  const [goalValue, setGoalValue] = useState('');
  const [direction, setDirection] = useState('not_exceed');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const list = await listTrackers();
      setTrackers(list);
      const uuid = initialUuid || list[0]?.uuid || null;
      setTrackerUuid(uuid);
      if (uuid) {
        const t = await getTracker(uuid);
        if (t?.goal_value !== null && t?.goal_value !== undefined) setGoalValue(String(t.goal_value));
        if (t?.goal_direction) setDirection(t.goal_direction);
      }
    })();
  }, [initialUuid]);

  const pickTracker = async (uuid) => {
    setTrackerUuid(uuid);
    const t = await getTracker(uuid);
    setGoalValue(t?.goal_value !== null && t?.goal_value !== undefined ? String(t.goal_value) : '');
    setDirection(t?.goal_direction || 'not_exceed');
  };

  const save = async () => {
    if (!trackerUuid) return Alert.alert('Выберите трекер');
    const raw = goalValue.trim().replace(',', '.');
    const n = raw === '' ? null : Number(raw);
    if (n !== null && (!Number.isFinite(n) || n < 0)) return Alert.alert('Проверьте значение цели');
    setSaving(true);
    try {
      await saveTracker({ goal_value: n, goal_direction: n === null ? null : direction }, trackerUuid);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Не удалось сохранить', e?.message || '');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Section title="Трекер">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 8 }}>
            {trackers.map((t) => (
              <Chip key={t.uuid} label={t.name} selected={t.uuid === trackerUuid} onPress={() => pickTracker(t.uuid)} />
            ))}
          </View>
          {trackers.length === 0 && (
            <Text style={{ color: colors.textSecondary, paddingHorizontal: 16 }}>Сначала создайте трекер</Text>
          )}
        </Section>
        <Field label="Целевое значение (пусто - цель снята)">
          <Input value={goalValue} onChangeText={setGoalValue} keyboardType="decimal-pad" placeholder="например 70" />
        </Field>
        <Section title="Направление">
          <View style={{ flexDirection: 'row', paddingHorizontal: 12, gap: 8 }}>
            {DIRECTIONS.map((d) => (
              <Chip key={d.key} label={d.label} selected={direction === d.key} onPress={() => setDirection(d.key)} />
            ))}
          </View>
        </Section>
        <PrimaryButton title="Сохранить" onPress={save} loading={saving} disabled={!trackerUuid} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default function GoalEditScreen({ navigation, route }) {
  return (
    <JournalGate navigation={navigation}>
      <Content navigation={navigation} route={route} />
    </JournalGate>
  );
}
