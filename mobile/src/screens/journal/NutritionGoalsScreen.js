import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { useJournal } from '../../context/JournalContext';
import { useNotifications } from '../../context/NotificationContext';
import { Chip, Field, Input, JournalGate, PrimaryButton, Section, useColors } from '../../components/journal/common';
import { updateSettings } from '../../journal/db/repos/settings';
import { journalAiErrorMessage, journalApi } from '../../api/journal';

const LIMITS = { kcal_goal: 20000, protein_g_goal: 2000, fat_g_goal: 2000, carbs_g_goal: 5000, water_ml_goal: 20000 };

const ACTIVITY = [
  { value: 'sedentary', label: 'Сидячая' },
  { value: 'light', label: 'Лёгкая' },
  { value: 'moderate', label: 'Средняя' },
  { value: 'active', label: 'Высокая' },
  { value: 'very_active', label: 'Очень высокая' },
];

const GOALS = [
  { value: 'lose', label: 'Похудеть' },
  { value: 'maintain', label: 'Поддержать' },
  { value: 'gain', label: 'Набрать' },
];

const ageFromBirthDate = (iso) => {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return age;
};

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
  const { currentUser, loadUser } = useNotifications();
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [sex, setSex] = useState(currentUser?.gender || 'male');
  const [activity, setActivity] = useState('moderate');
  const [goal, setGoal] = useState('maintain');
  const [planLoading, setPlanLoading] = useState(false);
  const [advice, setAdvice] = useState('');
  const [formulaKcal, setFormulaKcal] = useState(null);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

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

  const calculatePlan = async () => {
    const ageNum = ageFromBirthDate(currentUser?.birth_date);
    const height = currentUser?.height_cm;
    const weight = currentUser?.weight_kg;
    if (!currentUser?.birth_date || !height || !weight) {
      return Alert.alert('Заполните профиль', 'Укажите дату рождения, рост и вес в профиле');
    }
    if (!ageNum || ageNum < 14 || ageNum > 100) return Alert.alert('Проверьте дату рождения', 'Возраст из профиля должен быть от 14 до 100 лет');
    setPlanLoading(true);
    try {
      const { data } = await journalApi.nutritionPlan({
        sex, age: ageNum, height_cm: height, weight_kg: Number(weight), activity, goal,
      });
      setValues((v) => ({
        ...v,
        kcal_goal: String(data.recommended.kcal),
        protein_g_goal: String(data.recommended.protein_g),
        fat_g_goal: String(data.recommended.fat_g),
        carbs_g_goal: String(data.recommended.carbs_g),
      }));
      setFormulaKcal(data.plan.kcal);
      setAdvice(data.advice);
    } catch (e) {
      Alert.alert('Не удалось рассчитать', journalAiErrorMessage(e));
    } finally {
      setPlanLoading(false);
    }
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
        <PrimaryButton title="Рассчитать БЖУ из калорий (25/30/45 %)" onPress={fillMacros} />
        <Section title="Расчёт по анкете" style={{ marginTop: 16 }}>
          <Field label="Пол">
            <Chip label="Мужской" selected={sex === 'male'} onPress={() => setSex('male')} />
            <Chip label="Женский" selected={sex === 'female'} onPress={() => setSex('female')} />
          </Field>
          <Text style={{ color: colors.textSecondary, fontSize: 13, paddingHorizontal: 12, paddingBottom: 8 }}>
            Возраст, рост и вес берутся из профиля{currentUser?.birth_date ? `: ${ageFromBirthDate(currentUser.birth_date)} лет` : ' (дата рождения не заполнена)'}.
          </Text>
          <Field label="Активность">
            {ACTIVITY.map((a) => (
              <Chip key={a.value} label={a.label} selected={activity === a.value} onPress={() => setActivity(a.value)} />
            ))}
          </Field>
          <Field label="Цель">
            {GOALS.map((g) => (
              <Chip key={g.value} label={g.label} selected={goal === g.value} onPress={() => setGoal(g.value)} />
            ))}
          </Field>
          <PrimaryButton title="Рассчитать и получить советы ИИ" onPress={calculatePlan} loading={planLoading} />
          {!!advice && (
            <Text style={{ color: colors.textSecondary, fontSize: 13, paddingHorizontal: 12, paddingTop: 10 }}>
              Формула: {formulaKcal} ккал. Значения выше предложил ИИ (отклонение не больше 15%). Сохраните их, если подходят.
            </Text>
          )}
          {!!advice && (
            <Text style={{ color: colors.text, fontSize: 14, paddingHorizontal: 12, paddingTop: 10 }}>{advice}</Text>
          )}
        </Section>
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
