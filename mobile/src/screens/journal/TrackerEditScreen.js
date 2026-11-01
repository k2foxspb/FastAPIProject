import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Chip, Field, HeaderButton, Input, JournalGate, PrimaryButton, useColors } from '../../components/journal/common';
import { TRACKER_TEMPLATES, VALUE_TYPES, deleteTracker, getTracker, saveTracker } from '../../journal/db/repos/trackers';

const ICONS = ['pulse-outline', 'scale-outline', 'bed-outline', 'happy-outline', 'heart-outline', 'checkmark-done-outline',
  'water-outline', 'walk-outline', 'book-outline', 'cafe-outline', 'medkit-outline', 'leaf-outline', 'flame-outline', 'moon-outline'];
const COLORS = ['#4F8EF7', '#7E57C2', '#FFB300', '#E53935', '#43A047', '#00ACC1', '#F06292', '#8D6E63'];

const toNumber = (text) => {
  const s = String(text ?? '').replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
};
const toText = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

const TrackerForm = ({ navigation, route }) => {
  const colors = useColors();
  const uuid = route.params?.uuid || null;
  const [loaded, setLoaded] = useState(!uuid);
  const [existing, setExisting] = useState(null);
  const [form, setForm] = useState({
    name: '', value_type: 'number', unit: '', icon: 'pulse-outline', color: COLORS[0], scale_min: '1', scale_max: '5',
    frequency: 'daily', goal_value: '', goal_direction: null, template_key: null, archived: false,
  });
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (!uuid) return;
    getTracker(uuid).then((t) => {
      if (!t) {
        navigation.goBack();
        return;
      }
      setExisting(t);
      setForm({
        name: t.name, value_type: t.value_type, unit: t.unit || '', icon: t.icon || 'pulse-outline', color: t.color || COLORS[0],
        scale_min: toText(t.scale_min ?? 1), scale_max: toText(t.scale_max ?? 5), frequency: t.frequency || 'daily',
        goal_value: toText(t.goal_value), goal_direction: t.goal_direction, template_key: t.template_key, archived: !!t.archived,
      });
      setLoaded(true);
    });
  }, [uuid, navigation]);

  const applyTemplate = (tpl) => set({
    name: tpl.name, value_type: tpl.value_type, unit: tpl.unit || '', icon: tpl.icon, color: tpl.color,
    scale_min: toText(tpl.scale_min ?? 1), scale_max: toText(tpl.scale_max ?? 5), frequency: tpl.frequency, template_key: tpl.template_key,
  });

  const save = async () => {
    if (!form.name.trim()) return Alert.alert('Введите название');
    const scaleMin = toNumber(form.scale_min);
    const scaleMax = toNumber(form.scale_max);
    if (form.value_type === 'scale' && (scaleMin === null || scaleMax === null || Number.isNaN(scaleMin) || Number.isNaN(scaleMax) || scaleMin >= scaleMax)) {
      return Alert.alert('Шкала', 'Минимум должен быть меньше максимума');
    }
    const goal = toNumber(form.goal_value);
    if (Number.isNaN(goal)) return Alert.alert('Цель должна быть числом');
    setSaving(true);
    try {
      await saveTracker({
        name: form.name.trim().slice(0, 100),
        value_type: form.value_type,
        unit: form.unit.trim() || null,
        icon: form.icon,
        color: form.color,
        scale_min: form.value_type === 'scale' ? scaleMin : null,
        scale_max: form.value_type === 'scale' ? scaleMax : null,
        frequency: form.frequency,
        goal_value: form.value_type === 'text' ? null : goal,
        goal_direction: goal === null ? null : (form.goal_direction || 'reach'),
        template_key: form.template_key,
        sort_order: existing?.sort_order ?? 0,
        archived: form.archived,
      }, uuid);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Не удалось сохранить', e?.message || '');
    } finally {
      setSaving(false);
    }
    return null;
  };

  const remove = () => {
    Alert.alert('Удалить трекер?', 'Все значения трекера тоже будут удалены. Можно вместо этого отправить его в архив.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          await deleteTracker(uuid);
          navigation.pop(2);
        },
      },
    ]);
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: uuid ? 'Трекер' : 'Новый трекер',
      headerRight: () => (uuid ? <HeaderButton icon="trash-outline" color={colors.error} onPress={remove} /> : null),
    });
  });

  if (!loaded) return null;
  const valueTypeLocked = !!uuid; // смена типа сломала бы уже записанные значения

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {!uuid && (
          <Field label="Шаблоны">
            <View style={styles.wrap}>
              {TRACKER_TEMPLATES.map((t) => (
                <Chip key={t.template_key} label={t.name} icon={t.icon} color={t.color} selected={form.template_key === t.template_key} onPress={() => applyTemplate(t)} />
              ))}
            </View>
          </Field>
        )}
        <Field label="Название">
          <Input value={form.name} onChangeText={(name) => set({ name })} placeholder="Например, вес" maxLength={100} />
        </Field>
        <Field label={valueTypeLocked ? 'Тип значения (нельзя изменить)' : 'Тип значения'}>
          <View style={styles.wrap}>
            {VALUE_TYPES.map((t) => (
              <Chip key={t.key} label={t.label} selected={form.value_type === t.key} onPress={() => !valueTypeLocked && set({ value_type: t.key })} />
            ))}
          </View>
        </Field>
        {(form.value_type === 'number') && (
          <Field label="Единица измерения">
            <Input value={form.unit} onChangeText={(unit) => set({ unit })} placeholder="кг, шаги, стаканы" maxLength={20} />
          </Field>
        )}
        {form.value_type === 'scale' && (
          <Field label="Шкала: от и до">
            <View style={styles.row}>
              <Input style={styles.half} value={form.scale_min} onChangeText={(v) => set({ scale_min: v })} keyboardType="numbers-and-punctuation" />
              <Input style={styles.half} value={form.scale_max} onChangeText={(v) => set({ scale_max: v })} keyboardType="numbers-and-punctuation" />
            </View>
          </Field>
        )}
        {form.value_type !== 'text' && (
          <>
            <Field label={form.value_type === 'duration' ? 'Цель, минут' : 'Цель'}>
              <Input value={form.goal_value} onChangeText={(v) => set({ goal_value: v })} placeholder="Необязательно" keyboardType="numbers-and-punctuation" />
            </Field>
            {!!form.goal_value && (
              <Field>
                <View style={styles.wrap}>
                  <Chip label="Достичь" selected={(form.goal_direction || 'reach') === 'reach'} onPress={() => set({ goal_direction: 'reach' })} />
                  <Chip label="Не превышать" selected={form.goal_direction === 'not_exceed'} onPress={() => set({ goal_direction: 'not_exceed' })} />
                </View>
              </Field>
            )}
          </>
        )}
        <Field label="Как часто">
          <View style={styles.wrap}>
            <Chip label="Каждый день" selected={form.frequency === 'daily'} onPress={() => set({ frequency: 'daily' })} />
            <Chip label="Каждую неделю" selected={form.frequency === 'weekly'} onPress={() => set({ frequency: 'weekly' })} />
            <Chip label="Когда угодно" selected={form.frequency === 'any'} onPress={() => set({ frequency: 'any' })} />
          </View>
        </Field>
        <Field label="Иконка">
          <View style={styles.wrap}>
            {ICONS.map((i) => <Chip key={i} label="" icon={i} color={form.color} selected={form.icon === i} onPress={() => set({ icon: i })} />)}
          </View>
        </Field>
        <Field label="Цвет">
          <View style={styles.wrap}>
            {COLORS.map((c) => <Chip key={c} label="" icon="ellipse" color={c} selected={form.color === c} onPress={() => set({ color: c })} />)}
          </View>
        </Field>
        {!!uuid && (
          <Field>
            <View style={styles.switchRow}>
              <Text style={{ color: colors.text, fontSize: 16, flex: 1 }}>В архиве</Text>
              <Switch value={form.archived} onValueChange={(archived) => set({ archived })} />
            </View>
          </Field>
        )}
        <PrimaryButton title="Сохранить" onPress={save} loading={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default function TrackerEditScreen({ navigation, route }) {
  return (
    <JournalGate navigation={navigation}>
      <TrackerForm navigation={navigation} route={route} />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  half: { width: '48%' },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
});
