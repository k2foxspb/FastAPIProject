import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Switch, Text,
  TouchableOpacity, View,
} from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useJournal, useJournalQuery } from '../../context/JournalContext';
import { Chip, EmptyState, Input, JournalGate, PrimaryButton, useColors } from '../../components/journal/common';
import { macrosLine, NutrientInputs, PortionModal } from '../../components/journal/diet';
import {
  entryFromFood, listFrequentFoods, listMealTypes, listRecentFoods, saveFood, saveFoodEntry, searchFoods,
} from '../../journal/db/repos/diet';
import { journalAiErrorMessage, journalApi } from '../../api/journal';
import { nowTime } from '../../journal/utils/dates';
import { formatAmount, NUTRIENTS, parseAmount, round2 } from '../../journal/utils/nutrition';

const TABS = [
  { key: 'recent', label: 'Недавние' },
  { key: 'frequent', label: 'Частые' },
  { key: 'all', label: 'Все' },
];

// Время записи: сегодня - текущее, другой день - время приёма пищи по умолчанию
export const entryTimeFor = (date, today, mealType) => (date === today ? nowTime() : (mealType?.default_time || null));

const toText = (n) => (n === null || n === undefined ? '' : String(round2(n)).replace('.', ','));

// ---------------------------------------------------------------- ИИ-оценка

const AiEstimateModal = ({ visible, onClose, onSaved, date, mealTypeUuid, mealType }) => {
  const colors = useColors();
  const { today } = useJournal();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]); // { name, grams, values: {kcal..: string}, per100, include }
  const [saveToBase, setSaveToBase] = useState(true);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setItems([]);
    setText('');
  };

  const estimate = async () => {
    if (text.trim().length < 2) return;
    setLoading(true);
    try {
      const { data } = await journalApi.estimateNutrition(text.trim());
      setItems((data.items || []).map((i) => ({
        name: i.name,
        grams: toText(i.grams),
        values: { kcal: toText(i.kcal), protein: toText(i.protein), fat: toText(i.fat), carbs: toText(i.carbs) },
        per100: { kcal: i.kcal_100, protein: i.protein_100, fat: i.fat_100, carbs: i.carbs_100 },
        include: true,
      })));
    } catch (e) {
      Alert.alert('ИИ-оценка', journalAiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const update = (index, patch) => setItems((list) => list.map((it, i) => (i === index ? { ...it, ...patch } : it)));

  // Изменение веса пересчитывает КБЖУ по значениям на 100 г
  const changeGrams = (index, value) => {
    const item = items[index];
    const g = parseAmount(value);
    const patch = { grams: value };
    if (g) {
      patch.values = {};
      NUTRIENTS.forEach((n) => { patch.values[n] = toText((Number(item.per100[n]) || 0) * g / 100); });
    }
    update(index, patch);
  };

  const save = async () => {
    const chosen = items.filter((i) => i.include);
    for (const it of chosen) {
      if (!it.name.trim() || !parseAmount(it.grams)) return Alert.alert('Проверьте значения', `Укажите название и вес для «${it.name || '…'}»`);
    }
    setSaving(true);
    try {
      for (const it of chosen) {
        const grams = parseAmount(it.grams);
        const values = {};
        NUTRIENTS.forEach((n) => { values[n] = parseAmount(it.values[n]) || 0; });
        let foodUuid = null;
        const per100 = {};
        NUTRIENTS.forEach((n) => { per100[n] = values[n] * 100 / grams; });
        // Неправдоподобные значения на 100 г сервер не примет в базу - сохраняем только запись
        const plausible = per100.kcal <= 900 && per100.protein <= 100 && per100.fat <= 100 && per100.carbs <= 100;
        if (saveToBase && plausible) {
          // В базу - значения на 100 г с учётом правок пользователя
          foodUuid = await saveFood({
            name: it.name.trim(),
            kcal_100: per100.kcal,
            protein_100: per100.protein,
            fat_100: per100.fat,
            carbs_100: per100.carbs,
            serving_g: grams,
            source: 'ai',
          });
        }
        await saveFoodEntry({
          entry_date: date,
          entry_time: entryTimeFor(date, today, mealType),
          meal_type_uuid: mealTypeUuid,
          food_uuid: foodUuid,
          name: it.name.trim(),
          grams,
          ...values,
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      reset();
      onSaved();
    } catch (e) {
      Alert.alert('Не удалось сохранить', e?.message || '');
    } finally {
      setSaving(false);
    }
  };

  const chosenCount = items.filter((i) => i.include).length;
  const totalKcal = items.filter((i) => i.include).reduce((s, i) => s + (parseAmount(i.values.kcal) || 0), 0);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
          <TouchableOpacity onPress={onClose} hitSlop={8}><Icon name="close" size={26} color={colors.text} /></TouchableOpacity>
          <Text style={[styles.modalTitle, { color: colors.text }]}>Оценка ИИ</Text>
          <View style={{ width: 26 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: colors.textSecondary, marginBottom: 8 }}>
            Опишите, что вы съели, например: «тарелка борща со сметаной и 2 куска хлеба». ИИ предложит КБЖУ - проверьте и поправьте перед сохранением.
          </Text>
          <Input value={text} onChangeText={setText} placeholder="Что вы съели?" multiline maxLength={1000} style={{ minHeight: 80, textAlignVertical: 'top' }} />
          <PrimaryButton title="Оценить" onPress={estimate} loading={loading} disabled={text.trim().length < 2} style={{ marginHorizontal: 0 }} />

          {items.map((it, index) => (
            <View key={index} style={[styles.aiCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: it.include ? 1 : 0.5 }]}>
              <View style={styles.aiRow}>
                <TouchableOpacity onPress={() => update(index, { include: !it.include })} hitSlop={8}>
                  <Icon name={it.include ? 'checkbox' : 'square-outline'} size={24} color={colors.primary} />
                </TouchableOpacity>
                <Input value={it.name} onChangeText={(v) => update(index, { name: v })} style={{ flex: 1, marginLeft: 8 }} maxLength={200} />
              </View>
              <View style={[styles.aiRow, { marginTop: 8 }]}>
                <Text style={{ color: colors.textSecondary, width: 70 }}>Вес, г</Text>
                <Input value={it.grams} onChangeText={(v) => changeGrams(index, v.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" style={{ flex: 1 }} maxLength={7} />
              </View>
              <View style={{ marginTop: 8 }}>
                <NutrientInputs values={it.values} onChange={(values) => update(index, { values })} />
              </View>
            </View>
          ))}

          {items.length > 0 && (
            <>
              <View style={[styles.aiRow, { marginTop: 12 }]}>
                <Text style={{ flex: 1, color: colors.text }}>Сохранить в мои продукты</Text>
                <Switch value={saveToBase} onValueChange={setSaveToBase} />
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 8 }}>
                Оценка приблизительная. Итого: {formatAmount(totalKcal, 0)} ккал
              </Text>
              <PrimaryButton
                title={chosenCount ? `Сохранить (${chosenCount})` : 'Ничего не выбрано'}
                onPress={save}
                loading={saving}
                disabled={!chosenCount}
                style={{ marginHorizontal: 0 }}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

// ---------------------------------------------------------------- экран

const SearchContent = ({ navigation, route }) => {
  const colors = useColors();
  const { today } = useJournal();
  const date = route.params?.date || today;
  const mealTypeUuid = route.params?.mealTypeUuid || null;
  const manage = !!route.params?.manage;
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState(manage ? 'all' : 'recent');
  const [portionFood, setPortionFood] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const { data: mealTypes } = useJournalQuery(() => listMealTypes(), []);
  const mealType = useMemo(() => (mealTypes || []).find((m) => m.uuid === mealTypeUuid) || null, [mealTypes, mealTypeUuid]);

  const { data: foods, loading } = useJournalQuery(() => {
    if (query.trim()) return searchFoods(query, { limit: 100 });
    if (tab === 'recent') return listRecentFoods(30);
    if (tab === 'frequent') return listFrequentFoods(30);
    return searchFoods('', { limit: 300 });
  }, [query, tab]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: manage ? 'Мои продукты' : (mealType ? `Добавить: ${mealType.name}` : 'Добавить еду') });
  }, [navigation, manage, mealType]);

  const editFood = useCallback((food) => {
    navigation.navigate(food.is_recipe ? 'RecipeEdit' : 'FoodEdit', { uuid: food.uuid });
  }, [navigation]);

  const addPortion = async (grams) => {
    const food = portionFood;
    setPortionFood(null);
    try {
      await saveFoodEntry(entryFromFood(food, grams, {
        entry_date: date,
        entry_time: entryTimeFor(date, today, mealType),
        meal_type_uuid: mealTypeUuid,
      }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Не удалось сохранить', e?.message || '');
    }
  };

  const actions = [
    !manage && { key: 'manual', icon: 'create-outline', label: 'Вручную', onPress: () => navigation.navigate('FoodEntryEdit', { date, mealTypeUuid }) },
    !manage && { key: 'ai', icon: 'sparkles-outline', label: 'ИИ', onPress: () => setAiOpen(true) },
    { key: 'food', icon: 'add-circle-outline', label: 'Продукт', onPress: () => navigation.navigate('FoodEdit', {}) },
    { key: 'recipe', icon: 'restaurant-outline', label: 'Рецепт', onPress: () => navigation.navigate('RecipeEdit', {}) },
  ].filter(Boolean);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.searchRow}>
        <Icon name="search" size={18} color={colors.textSecondary} style={styles.searchIcon} />
        <Input value={query} onChangeText={setQuery} placeholder="Поиск в моих продуктах" style={{ paddingLeft: 34 }} autoFocus={!manage} returnKeyType="search" />
      </View>
      <View style={styles.actions}>
        {actions.map((a) => (
          <TouchableOpacity key={a.key} style={[styles.action, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={a.onPress}>
            <Icon name={a.icon} size={20} color={colors.primary} />
            <Text style={{ color: colors.text, fontSize: 12, marginTop: 3 }}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {!query.trim() && (
        <View style={styles.tabs}>
          {TABS.map((t) => <Chip key={t.key} label={t.label} selected={tab === t.key} onPress={() => setTab(t.key)} />)}
        </View>
      )}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />
      ) : (
        <FlatList
          data={foods || []}
          keyExtractor={(f) => f.uuid}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.item, { backgroundColor: colors.card }]}
              onPress={() => (manage ? editFood(item) : setPortionFood(item))}
              onLongPress={() => editFood(item)}
            >
              <Icon name={item.is_recipe ? 'restaurant-outline' : item.source === 'ai' ? 'sparkles-outline' : 'nutrition-outline'} size={20} color={colors.primary} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: colors.text, fontSize: 15 }} numberOfLines={2}>
                  {item.name}{item.brand ? <Text style={{ color: colors.textSecondary }}> · {item.brand}</Text> : null}
                </Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                  на 100 г: {formatAmount(item.kcal_100, 0)} ккал · {macrosLine({ protein: item.protein_100, fat: item.fat_100, carbs: item.carbs_100 })}
                </Text>
              </View>
              <Icon name={manage ? 'chevron-forward' : 'add-circle-outline'} size={22} color={manage ? colors.textSecondary : colors.primary} />
            </TouchableOpacity>
          )}
          ListEmptyComponent={(
            <EmptyState
              icon="nutrition-outline"
              title={query.trim() ? 'Ничего не найдено' : tab === 'all' ? 'В вашей базе пока нет продуктов' : 'Здесь появятся продукты, которые вы добавляете'}
              subtitle={manage ? 'Добавьте продукт или рецепт' : 'Введите еду вручную или попросите ИИ оценить КБЖУ - продукт сохранится в вашу базу'}
            />
          )}
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      )}
      <PortionModal visible={!!portionFood} food={portionFood} onClose={() => setPortionFood(null)} onSave={addPortion} />
      <AiEstimateModal
        visible={aiOpen}
        onClose={() => setAiOpen(false)}
        onSaved={() => {
          setAiOpen(false);
          navigation.goBack();
        }}
        date={date}
        mealTypeUuid={mealTypeUuid}
        mealType={mealType}
      />
    </View>
  );
};

export default function FoodSearchScreen({ navigation, route }) {
  return (
    <JournalGate navigation={navigation}>
      <SearchContent navigation={navigation} route={route} />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  searchRow: { marginHorizontal: 12, marginTop: 12, justifyContent: 'center' },
  searchIcon: { position: 'absolute', left: 12, zIndex: 1 },
  actions: { flexDirection: 'row', marginHorizontal: 8, marginTop: 10 },
  action: { flex: 1, marginHorizontal: 4, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  tabs: { flexDirection: 'row', marginHorizontal: 12, marginTop: 12 },
  item: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 6, borderRadius: 12, padding: 12 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 54 : 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  modalTitle: { fontSize: 17, fontWeight: '600' },
  aiCard: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12, marginTop: 12 },
  aiRow: { flexDirection: 'row', alignItems: 'center' },
});
