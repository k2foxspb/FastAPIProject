import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TouchableOpacity } from 'react-native';
import { useJournal } from '../../context/JournalContext';
import { Field, Input, JournalGate, PrimaryButton, Section, useColors } from '../../components/journal/common';
import { updateSettings } from '../../journal/db/repos/settings';

const LIMITS = { kcal_goal: 20000, protein_g_goal: 2000, fat_g_goal: 2000, carbs_g_goal: 5000, water_ml_goal: 20000 };

const FIELDS = [
  { key: 'kcal_goal', label: 'Калории, ккал в день', placeholder: 'например 2000' },
  { key: 'protein_g_goal', label: 'Белки, г', placeholder: 'например 100' },
  { key: 'fat_g_goal', label: 'Жиры, г', placeholder: 'например 70' },
  { key: 'carbs_g_goal', label: 'Углеводы, г', placeholder: 'например 250' },
  { key: 'water_ml_goal', label: 'Вода, мл в день', placeholder: 'например 2000' },
];

// Цели питания хранятся в настройках журнала (синхронизируются между устройствами)
const Content = ({ navigation }) => {
  const colors = useColors();
  const { settings } = useJournal();
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next = {};
    FIELDS.forEach((f) => { next[f.key] = settings?.[f.key] ? String(settings[f.key]) : ''; });
    setValues(next);
  }, [settings]);

  // Подсказка: БЖУ из калорий в пропорции 25/30/45 % (1 г белка и углеводов - 4 ккал, жира - 9 ккал)
  const fillMacros = () => {
    const kcal = parseInt(values.kcal_goal, 10);
    if (!kcal) return Alert.alert('Сначала укажите калории');
    setValues((v) => ({
      ...v,
      protein_g_goal: String(Math.round((kcal * 0.25) / 4)),
      fat_g_goal: String(Math.round((kcal * 0.3) / 9)),
      carbs_g_goal: String(Math.round((kcal * 0.45) / 4)),
    }));
  };

  const save = async () => {
    const changes = {};
    for (const f of FIELDS) {
      const raw = (values[f.key] || '').trim();
      if (!raw) {
        changes[f.key] = null;
        continue;
      }
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 0 || n > LIMITS[f.key]) return Alert.alert('Проверьте значение', f.label);
      changes[f.key] = n;
    }
    setSaving(true);
    try {
      await updateSettings(changes);
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
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <Input
              value={values[f.key] || ''}
              onChangeText={(t) => setValues((v) => ({ ...v, [f.key]: t.replace(/\D/g, '') }))}
              keyboardType="number-pad"
              placeholder={f.placeholder}
              maxLength={5}
            />
          </Field>
        ))}
        <TouchableOpacity onPress={fillMacros} style={{ marginHorizontal: 16, marginTop: 12 }}>
          <Text style={{ color: colors.primary }}>Рассчитать БЖУ из калорий (25/30/45 %)</Text>
        </TouchableOpacity>
        <Section style={{ marginTop: 16 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 13, paddingHorizontal: 12 }}>
            Пустое поле - цель не задана. Это ориентиры, а не медицинские рекомендации.
          </Text>
        </Section>
        <PrimaryButton title="Сохранить" onPress={save} loading={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default function NutritionGoalsScreen({ navigation }) {
  return (
    <JournalGate navigation={navigation}>
      <Content navigation={navigation} />
    </JournalGate>
  );
}
