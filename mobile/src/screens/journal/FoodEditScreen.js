import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Field, HeaderButton, Input, JournalGate, PrimaryButton, useColors } from '../../components/journal/common';
import { NutrientInputs } from '../../components/journal/diet';
import { deleteFood, getFood, saveFood } from '../../journal/db/repos/diet';
import { parseAmount, round2 } from '../../journal/utils/nutrition';

const toText = (n) => (n === null || n === undefined ? '' : String(round2(n)).replace('.', ','));

// Продукт личной базы: КБЖУ на 100 г, порция, штрихкод.
const EditContent = ({ navigation, route }) => {
  const colors = useColors();
  const uuid = route.params?.uuid || null;
  const [loaded, setLoaded] = useState(!uuid);
  const [original, setOriginal] = useState(null);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [values, setValues] = useState({ kcal: '', protein: '', fat: '', carbs: '' });
  const [serving, setServing] = useState('');
  const [barcode, setBarcode] = useState(route.params?.barcode || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!uuid) return;
    getFood(uuid).then((f) => {
      if (!f) {
        navigation.goBack();
        return;
      }
      setOriginal(f);
      setName(f.name);
      setBrand(f.brand || '');
      setValues({ kcal: toText(f.kcal_100), protein: toText(f.protein_100), fat: toText(f.fat_100), carbs: toText(f.carbs_100) });
      setServing(toText(f.serving_g));
      setBarcode(f.barcode || '');
      setLoaded(true);
    });
  }, [uuid, navigation]);

  const save = async () => {
    if (!name.trim()) return Alert.alert('Укажите название');
    const per100 = {
      kcal_100: parseAmount(values.kcal) || 0,
      protein_100: parseAmount(values.protein) || 0,
      fat_100: parseAmount(values.fat) || 0,
      carbs_100: parseAmount(values.carbs) || 0,
    };
    if (per100.kcal_100 > 900 || per100.protein_100 > 100 || per100.fat_100 > 100 || per100.carbs_100 > 100) {
      return Alert.alert('Проверьте значения', 'На 100 г не больше 900 ккал и 100 г каждого нутриента');
    }
    const code = barcode.trim();
    if (code && !/^\d{1,32}$/.test(code)) return Alert.alert('Штрихкод должен состоять из цифр');
    setSaving(true);
    try {
      await saveFood({
        ...(original || {}),
        name: name.trim(),
        brand: brand.trim() || null,
        ...per100,
        serving_g: parseAmount(serving) || null,
        barcode: code || null,
        source: original?.source || 'manual',
        is_recipe: false,
      }, uuid);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Не удалось сохранить', e?.message || '');
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    Alert.alert('Удалить продукт?', 'Записи о еде с этим продуктом останутся в журнале.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          await deleteFood(uuid);
          navigation.goBack();
        },
      },
    ]);
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: uuid ? 'Продукт' : 'Новый продукт',
      headerRight: () => (uuid ? <HeaderButton icon="trash-outline" color={colors.error} onPress={remove} /> : null),
    });
  });

  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Field label="Название">
          <Input value={name} onChangeText={setName} placeholder="Например, творог 5%" maxLength={200} autoFocus={!uuid} />
        </Field>
        <Field label="Производитель">
          <Input value={brand} onChangeText={setBrand} placeholder="Необязательно" maxLength={100} />
        </Field>
        <Field label="КБЖУ на 100 г">
          <NutrientInputs values={values} onChange={setValues} />
        </Field>
        <Field label="Обычная порция, г">
          <Input value={serving} onChangeText={(t) => setServing(t.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" placeholder="Необязательно" maxLength={7} />
        </Field>
        <Field label="Штрихкод">
          <Input value={barcode} onChangeText={(t) => setBarcode(t.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="Необязательно" maxLength={32} />
        </Field>
        {original?.source === 'ai' && (
          <Text style={{ color: colors.textSecondary, marginHorizontal: 16, marginTop: 8, fontSize: 12 }}>
            Значения предложены ИИ - при необходимости уточните их по упаковке.
          </Text>
        )}
        <PrimaryButton title="Сохранить" onPress={save} loading={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default function FoodEditScreen({ navigation, route }) {
  return (
    <JournalGate navigation={navigation}>
      <EditContent navigation={navigation} route={route} />
    </JournalGate>
  );
}
