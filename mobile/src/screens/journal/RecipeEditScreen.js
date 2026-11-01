import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  Alert, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useJournalQuery } from '../../context/JournalContext';
import { Field, HeaderButton, Input, JournalGate, PrimaryButton, Section, useColors } from '../../components/journal/common';
import { macrosLine } from '../../components/journal/diet';
import { deleteFood, getFood, listRecipeItems, saveRecipe, searchFoods } from '../../journal/db/repos/diet';
import { formatAmount, parseAmount, per100Of, portion, recipePer100, round2 } from '../../journal/utils/nutrition';

const toText = (n) => (n === null || n === undefined ? '' : String(round2(n)).replace('.', ','));

// Выбор ингредиента из своей базы (рецепты как ингредиенты не допускаются)
const IngredientPicker = ({ visible, onClose, onPick, excludeUuid }) => {
  const colors = useColors();
  const [query, setQuery] = useState('');
  const { data: foods } = useJournalQuery(() => searchFoods(query, { limit: 100 }), [query]);
  const list = (foods || []).filter((f) => !f.is_recipe && f.uuid !== excludeUuid);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[styles.modalHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={8}><Icon name="close" size={26} color={colors.text} /></TouchableOpacity>
          <Text style={[styles.modalTitle, { color: colors.text }]}>Ингредиент</Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={{ padding: 12 }}>
          <Input value={query} onChangeText={setQuery} placeholder="Поиск в моих продуктах" autoFocus />
        </View>
        <FlatList
          data={list}
          keyExtractor={(f) => f.uuid}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity style={[styles.row, { backgroundColor: colors.card }]} onPress={() => onPick(item)}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 15 }}>{item.name}</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                  на 100 г: {formatAmount(item.kcal_100, 0)} ккал · {macrosLine({ protein: item.protein_100, fat: item.fat_100, carbs: item.carbs_100 })}
                </Text>
              </View>
              <Icon name="add-circle-outline" size={22} color={colors.primary} />
            </TouchableOpacity>
          )}
          ListEmptyComponent={(
            <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 24, paddingHorizontal: 24 }}>
              Подходящих продуктов нет. Сначала добавьте продукт в свою базу.
            </Text>
          )}
        />
      </View>
    </Modal>
  );
};

// Рецепт: КБЖУ на 100 г готового блюда считается из ингредиентов и веса готового блюда.
const EditContent = ({ navigation, route }) => {
  const colors = useColors();
  const uuid = route.params?.uuid || null;
  const [loaded, setLoaded] = useState(!uuid);
  const [original, setOriginal] = useState(null);
  const [name, setName] = useState('');
  const [yieldText, setYieldText] = useState('');
  const [items, setItems] = useState([]); // { uuid?, ingredient_uuid, name, per100, gramsText }
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!uuid) return;
    (async () => {
      const recipe = await getFood(uuid);
      if (!recipe) {
        navigation.goBack();
        return;
      }
      const rows = await listRecipeItems(uuid);
      setOriginal(recipe);
      setName(recipe.name);
      setYieldText(toText(recipe.recipe_yield_g));
      setItems(rows.map((r) => ({
        uuid: r.uuid, ingredient_uuid: r.ingredient_uuid, name: r.ingredient_name, per100: r.per100, gramsText: toText(r.grams),
      })));
      setLoaded(true);
    })();
  }, [uuid, navigation]);

  const calc = useMemo(() => recipePer100(
    items.map((i) => ({ per100: i.per100, grams: parseAmount(i.gramsText) || 0 })),
    parseAmount(yieldText),
  ), [items, yieldText]);
  const rawWeight = items.reduce((s, i) => s + (parseAmount(i.gramsText) || 0), 0);

  const addIngredient = (food) => {
    setPickerOpen(false);
    setItems((list) => [...list, {
      ingredient_uuid: food.uuid, name: food.name, per100: per100Of(food), gramsText: String(food.serving_g || 100),
    }]);
  };

  const save = async () => {
    if (!name.trim()) return Alert.alert('Укажите название рецепта');
    if (!items.length) return Alert.alert('Добавьте хотя бы один ингредиент');
    if (items.some((i) => !parseAmount(i.gramsText))) return Alert.alert('Укажите вес каждого ингредиента');
    const p = calc.per100;
    if (p.kcal > 900 || p.protein > 100 || p.fat > 100 || p.carbs > 100) {
      return Alert.alert('Проверьте вес готового блюда', 'Получается больше 900 ккал или 100 г нутриентов на 100 г');
    }
    setSaving(true);
    try {
      await saveRecipe({
        ...(original || {}),
        name: name.trim(),
        recipe_yield_g: parseAmount(yieldText) || null,
        serving_g: original?.serving_g || null,
      }, items.map((i) => ({
        uuid: i.uuid, ingredient_uuid: i.ingredient_uuid, grams: parseAmount(i.gramsText), per100: i.per100,
      })), uuid);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Не удалось сохранить', e?.message || '');
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    Alert.alert('Удалить рецепт?', 'Записи о еде с этим блюдом останутся в журнале.', [
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
      title: uuid ? 'Рецепт' : 'Новый рецепт',
      headerRight: () => (uuid ? <HeaderButton icon="trash-outline" color={colors.error} onPress={remove} /> : null),
    });
  });

  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Field label="Название">
          <Input value={name} onChangeText={setName} placeholder="Например, плов с курицей" maxLength={200} autoFocus={!uuid} />
        </Field>

        <Section title="Ингредиенты" right={(
          <TouchableOpacity onPress={() => setPickerOpen(true)} hitSlop={8}>
            <Text style={{ color: colors.primary, fontSize: 13 }}>Добавить</Text>
          </TouchableOpacity>
        )}
        >
          {items.map((it, index) => {
            const g = parseAmount(it.gramsText) || 0;
            const p = portion(it.per100, g);
            return (
              <View key={it.uuid || `${it.ingredient_uuid}:${index}`} style={[styles.ingredient, { borderBottomColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 15 }} numberOfLines={1}>{it.name}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{formatAmount(p.kcal, 0)} ккал · {macrosLine(p)}</Text>
                </View>
                <Input
                  value={it.gramsText}
                  onChangeText={(t) => setItems((list) => list.map((x, i) => (i === index ? { ...x, gramsText: t.replace(/[^\d.,]/g, '') } : x)))}
                  keyboardType="decimal-pad"
                  style={styles.grams}
                  maxLength={7}
                />
                <Text style={{ color: colors.textSecondary, marginLeft: 4 }}>г</Text>
                <TouchableOpacity onPress={() => setItems((list) => list.filter((_, i) => i !== index))} hitSlop={8} style={{ marginLeft: 8 }}>
                  <Icon name="close-circle-outline" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            );
          })}
          {!items.length && (
            <TouchableOpacity onPress={() => setPickerOpen(true)} style={{ padding: 12 }}>
              <Text style={{ color: colors.textSecondary }}>Добавьте продукты из своей базы</Text>
            </TouchableOpacity>
          )}
        </Section>

        <Field label={`Вес готового блюда, г (сырой вес ${formatAmount(rawWeight, 0)} г)`}>
          <Input value={yieldText} onChangeText={(t) => setYieldText(t.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" placeholder="Если блюдо уварилось или ужарилось" maxLength={7} />
        </Field>

        <Section title="На 100 г готового блюда">
          <Text style={[styles.result, { color: colors.text }]}>
            {formatAmount(calc.per100.kcal, 0)} ккал · {macrosLine(calc.per100)}
          </Text>
        </Section>

        <PrimaryButton title="Сохранить" onPress={save} loading={saving} />
      </ScrollView>
      <IngredientPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addIngredient} excludeUuid={uuid} />
    </KeyboardAvoidingView>
  );
};

export default function RecipeEditScreen({ navigation, route }) {
  return (
    <JournalGate navigation={navigation}>
      <EditContent navigation={navigation} route={route} />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 54 : 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  modalTitle: { fontSize: 17, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 6, borderRadius: 12, padding: 12 },
  ingredient: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  grams: { width: 72, paddingVertical: 6, textAlign: 'right' },
  result: { fontSize: 16, fontWeight: '600', paddingHorizontal: 12, paddingVertical: 6 },
});
