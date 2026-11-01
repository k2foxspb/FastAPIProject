import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from 'react-native';
import { useJournal, useJournalQuery } from '../../context/JournalContext';
import { Chip, Field, HeaderButton, Input, JournalGate, PrimaryButton, useColors } from '../../components/journal/common';
import { DateField, TimeField } from '../../components/journal/DateTimeFields';
import AttachmentStrip from '../../components/journal/AttachmentStrip';
import { NutrientInputs } from '../../components/journal/diet';
import {
  deleteFoodEntry, getFood, getFoodEntry, listMealTypes, saveFood, saveFoodEntry,
} from '../../journal/db/repos/diet';
import { deleteAttachment, listAttachments } from '../../journal/db/repos/attachments';
import { newUuid } from '../../journal/utils/uuid';
import { NUTRIENTS, parseAmount, per100Of, portion, round2 } from '../../journal/utils/nutrition';
import { entryTimeFor } from './FoodSearchScreen';

const toText = (n) => (n === null || n === undefined ? '' : String(round2(n)).replace('.', ','));
const EMPTY_VALUES = { kcal: '', protein: '', fat: '', carbs: '' };

// Запись о еде: ручной ввод или правка. Если запись связана с продуктом базы,
// изменение веса пересчитывает КБЖУ по значениям продукта на 100 г.
const EditContent = ({ navigation, route }) => {
  const colors = useColors();
  const { today } = useJournal();
  const existingUuid = route.params?.uuid || null;
  // Для новой записи UUID создаётся сразу - к нему привязываются фото до сохранения
  const [uuid] = useState(() => existingUuid || newUuid());
  const savedRef = useRef(!!existingUuid);
  const [loaded, setLoaded] = useState(!existingUuid);
  const [date, setDate] = useState(route.params?.date || today);
  const [time, setTime] = useState(null);
  const [mealTypeUuid, setMealTypeUuid] = useState(route.params?.mealTypeUuid || null);
  const [name, setName] = useState('');
  const [gramsText, setGramsText] = useState('100');
  const [values, setValues] = useState(EMPTY_VALUES);
  const [note, setNote] = useState('');
  const [food, setFood] = useState(null);
  const [saveToBase, setSaveToBase] = useState(true);
  const [saving, setSaving] = useState(false);
  const { data: mealTypes } = useJournalQuery(() => listMealTypes(), []);

  useEffect(() => {
    if (!existingUuid) return;
    getFoodEntry(existingUuid).then(async (e) => {
      if (!e) {
        navigation.goBack();
        return;
      }
      setDate(e.entry_date);
      setTime(e.entry_time);
      setMealTypeUuid(e.meal_type_uuid);
      setName(e.name);
      setGramsText(toText(e.grams));
      setValues({ kcal: toText(e.kcal), protein: toText(e.protein), fat: toText(e.fat), carbs: toText(e.carbs) });
      setNote(e.note || '');
      if (e.food_uuid) setFood(await getFood(e.food_uuid));
      setLoaded(true);
    });
  }, [existingUuid, navigation]);

  // Время по умолчанию для новой записи - когда известны типы приёмов пищи
  useEffect(() => {
    if (existingUuid || time !== null || !mealTypes) return;
    setTime(entryTimeFor(date, today, mealTypes.find((m) => m.uuid === mealTypeUuid)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mealTypes]);

  // Новая запись закрыта без сохранения - убираем добавленные к ней фото
  useEffect(() => () => {
    if (savedRef.current) return;
    listAttachments(uuid).then((items) => items.forEach((a) => deleteAttachment(a.uuid))).catch(() => undefined);
  }, [uuid]);

  const changeGrams = (text) => {
    const clean = text.replace(/[^\d.,]/g, '');
    setGramsText(clean);
    const g = parseAmount(clean);
    if (food && g) {
      const p = portion(per100Of(food), g);
      setValues({ kcal: toText(p.kcal), protein: toText(p.protein), fat: toText(p.fat), carbs: toText(p.carbs) });
    }
  };

  const save = async () => {
    const grams = parseAmount(gramsText);
    if (!name.trim()) return Alert.alert('Укажите название');
    if (!grams) return Alert.alert('Укажите вес порции');
    const nums = {};
    NUTRIENTS.forEach((n) => { nums[n] = parseAmount(values[n]) || 0; });
    const per100 = {};
    NUTRIENTS.forEach((n) => { per100[n] = nums[n] * 100 / grams; });
    if (per100.kcal > 900 || per100.protein > 100 || per100.fat > 100 || per100.carbs > 100) {
      return Alert.alert('Проверьте значения', 'КБЖУ не может превышать 900 ккал и 100 г нутриентов на 100 г продукта');
    }
    setSaving(true);
    try {
      let foodUuid = food?.uuid || null;
      // Ручной ввод - по желанию сохраняем продукт в базу (значения на 100 г)
      if (!existingUuid && !foodUuid && saveToBase) {
        foodUuid = await saveFood({
          name: name.trim(),
          kcal_100: per100.kcal,
          protein_100: per100.protein,
          fat_100: per100.fat,
          carbs_100: per100.carbs,
          serving_g: grams,
          source: 'manual',
        });
      }
      await saveFoodEntry({
        entry_date: date,
        entry_time: time,
        meal_type_uuid: mealTypeUuid,
        food_uuid: foodUuid,
        name: name.trim(),
        grams,
        ...nums,
        note: note.trim() || null,
      }, uuid);
      savedRef.current = true;
      navigation.goBack();
    } catch (e) {
      Alert.alert('Не удалось сохранить', e?.message || '');
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    Alert.alert('Удалить запись?', null, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          await deleteFoodEntry(uuid);
          navigation.goBack();
        },
      },
    ]);
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: existingUuid ? 'Запись о еде' : 'Еда вручную',
      headerRight: () => (existingUuid ? <HeaderButton icon="trash-outline" color={colors.error} onPress={remove} /> : null),
    });
  });

  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Field label="Название">
          <Input value={name} onChangeText={setName} placeholder="Например, гречка с курицей" maxLength={200} autoFocus={!existingUuid} />
        </Field>
        {!!food && (
          <Text style={{ color: colors.textSecondary, marginHorizontal: 16, marginTop: 6, fontSize: 12 }}>
            Из базы: «{food.name}» - КБЖУ пересчитывается по весу
          </Text>
        )}
        <Field label="Вес порции, г">
          <Input value={gramsText} onChangeText={changeGrams} keyboardType="decimal-pad" maxLength={7} />
        </Field>
        <Field label="КБЖУ порции">
          <NutrientInputs values={values} onChange={setValues} />
        </Field>
        <Field label="Приём пищи">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {(mealTypes || []).map((m) => (
              <Chip key={m.uuid} label={m.name} icon={m.icon} selected={mealTypeUuid === m.uuid} onPress={() => setMealTypeUuid(mealTypeUuid === m.uuid ? null : m.uuid)} />
            ))}
          </View>
        </Field>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 3 }}>
            <Field label="Дата"><DateField value={date} onChange={(d) => d && setDate(d)} /></Field>
          </View>
          <View style={{ flex: 2 }}>
            <Field label="Время"><TimeField value={time} onChange={setTime} /></Field>
          </View>
        </View>
        <Field label="Заметка">
          <Input value={note} onChangeText={setNote} placeholder="Необязательно" maxLength={500} />
        </Field>
        <Field label="Фото">
          <AttachmentStrip ownerType="food_entry" ownerUuid={uuid} />
        </Field>
        {!existingUuid && !food && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 14 }}>
            <Text style={{ flex: 1, color: colors.text }}>Сохранить в мои продукты</Text>
            <Switch value={saveToBase} onValueChange={setSaveToBase} />
          </View>
        )}
        <PrimaryButton title="Сохранить" onPress={save} loading={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default function FoodEntryEditScreen({ navigation, route }) {
  return (
    <JournalGate navigation={navigation}>
      <EditContent navigation={navigation} route={route} />
    </JournalGate>
  );
}
