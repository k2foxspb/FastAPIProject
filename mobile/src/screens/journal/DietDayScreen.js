import React, { useCallback, useLayoutEffect, useMemo } from 'react';
import { Alert, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useJournal, useJournalQuery } from '../../context/JournalContext';
import { HeaderButton, JournalGate, Section, SyncBadge, useColors } from '../../components/journal/common';
import { macrosLine, NutritionSummary, WaterCard } from '../../components/journal/diet';
import { deleteFoodEntry, loadDietDay } from '../../journal/db/repos/diet';
import { addDays, formatDateRu, formatTime } from '../../journal/utils/dates';
import { formatAmount, sumNutrients } from '../../journal/utils/nutrition';

const OTHER_KEY = '__other';

const DietContent = ({ navigation, date }) => {
  const colors = useColors();
  const { settings } = useJournal();
  const { data } = useJournalQuery(() => loadDietDay(date), [date]);

  // Записи по приёмам пищи; у каждого приёма - кнопка «добавить», даже если он пуст
  const sections = useMemo(() => {
    if (!data) return [];
    const byMeal = {};
    data.entries.forEach((e) => {
      const key = e.meal_type_uuid && data.mealTypes.some((m) => m.uuid === e.meal_type_uuid) ? e.meal_type_uuid : OTHER_KEY;
      (byMeal[key] = byMeal[key] || []).push(e);
    });
    const result = data.mealTypes.map((m) => ({ key: m.uuid, meal: m, title: m.name, data: byMeal[m.uuid] || [] }));
    if (byMeal[OTHER_KEY]) result.push({ key: OTHER_KEY, meal: null, title: 'Без приёма пищи', data: byMeal[OTHER_KEY] });
    return result;
  }, [data]);

  const addFood = useCallback((mealTypeUuid) => {
    navigation.navigate('FoodSearch', { date, mealTypeUuid: mealTypeUuid === OTHER_KEY ? null : mealTypeUuid });
  }, [navigation, date]);

  const entryMenu = useCallback((entry) => {
    Alert.alert(entry.name, `${formatAmount(entry.grams, 0)} г · ${formatAmount(entry.kcal, 0)} ккал`, [
      { text: 'Изменить', onPress: () => navigation.navigate('FoodEntryEdit', { uuid: entry.uuid }) },
      { text: 'Удалить', style: 'destructive', onPress: () => deleteFoodEntry(entry.uuid) },
      { text: 'Отмена', style: 'cancel' },
    ]);
  }, [navigation]);

  if (!data) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  const header = (
    <>
      <Section title="Итоги дня" right={(
        <TouchableOpacity onPress={() => navigation.navigate('NutritionGoals')} hitSlop={8}>
          <Text style={{ color: colors.primary, fontSize: 13 }}>Цели</Text>
        </TouchableOpacity>
      )}
      >
        <NutritionSummary totals={data.totals} settings={settings} />
        {!settings?.kcal_goal && (
          <TouchableOpacity onPress={() => navigation.navigate('NutritionGoals')} style={styles.hint}>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Задайте цели по калориям и БЖУ, чтобы видеть прогресс</Text>
          </TouchableOpacity>
        )}
      </Section>
      <Section title="Вода">
        <WaterCard date={date} waterMl={data.waterMl} goal={settings?.water_ml_goal} />
      </Section>
    </>
  );

  return (
    <SectionList
      style={{ backgroundColor: colors.background }}
      sections={sections}
      keyExtractor={(item) => item.uuid}
      ListHeaderComponent={header}
      renderSectionHeader={({ section }) => {
        const sum = sumNutrients(section.data);
        return (
          <View style={styles.mealHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.mealTitle, { color: colors.text }]}>
                {section.title}
                {section.meal?.default_time ? <Text style={{ color: colors.textSecondary, fontSize: 13 }}>  {formatTime(section.meal.default_time)}</Text> : null}
              </Text>
              {section.data.length > 0 && (
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{formatAmount(sum.kcal, 0)} ккал · {macrosLine(sum)}</Text>
              )}
            </View>
            <TouchableOpacity onPress={() => addFood(section.key)} hitSlop={8} style={[styles.addBtn, { borderColor: colors.primary }]}>
              <Icon name="add" size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>
        );
      }}
      renderItem={({ item }) => (
        <TouchableOpacity style={[styles.item, { backgroundColor: 'transparent' }]} onPress={() => entryMenu(item)}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={2}>{item.name}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
              {formatAmount(item.grams, 0)} г{item.entry_time ? ` · ${formatTime(item.entry_time)}` : ''} · {macrosLine(item)}
            </Text>
          </View>
          <Text style={[styles.kcal, { color: colors.text }]}>{formatAmount(item.kcal, 0)}</Text>
        </TouchableOpacity>
      )}
      stickySectionHeadersEnabled={false}
      ListFooterComponent={(
        <Section style={{ marginBottom: 32 }}>
          <NavRow colors={colors} icon="restaurant-outline" label="Приёмы пищи и напоминания" onPress={() => navigation.navigate('MealTypes')} />
          <NavRow colors={colors} icon="list-outline" label="Мои продукты и рецепты" onPress={() => navigation.navigate('FoodSearch', { date, manage: true })} last />
        </Section>
      )}
    />
  );
};

const NavRow = ({ colors, icon, label, onPress, last }) => (
  <TouchableOpacity style={[styles.navRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]} onPress={onPress}>
    <Icon name={icon} size={20} color={colors.primary} />
    <Text style={{ flex: 1, fontSize: 16, marginLeft: 12, color: colors.text }}>{label}</Text>
    <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
  </TouchableOpacity>
);

export default function DietDayScreen({ navigation, route }) {
  const { today } = useJournal() || {};
  const date = route.params?.date || today;
  const colors = useColors();
  useLayoutEffect(() => {
    navigation.setOptions({
      title: `Питание · ${formatDateRu(date, { withYear: false })}`,
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <HeaderButton icon="chevron-back" onPress={() => navigation.setParams({ date: addDays(date, -1) })} />
          <HeaderButton icon="chevron-forward" onPress={() => navigation.setParams({ date: addDays(date, 1) })} />
          <SyncBadge />
        </View>
      ),
    });
  }, [navigation, date, colors]);
  return (
    <JournalGate navigation={navigation}>
      <DietContent navigation={navigation} date={date} />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  hint: { paddingHorizontal: 12, paddingTop: 6 },
  mealHeader: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 18, marginBottom: 6 },
  mealTitle: { fontSize: 16, fontWeight: '600' },
  addBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 6, borderRadius: 12, padding: 12 },
  itemTitle: { fontSize: 15 },
  kcal: { fontSize: 15, fontWeight: '600', marginLeft: 8 },
  navRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12 },
});
