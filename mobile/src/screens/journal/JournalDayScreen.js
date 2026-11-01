import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useJournal, useJournalQuery } from '../../context/JournalContext';
import { EmptyState, JournalGate, MOODS, SyncBadge, useColors } from '../../components/journal/common';
import ShareButton from '../../components/journal/ShareButton';
import { cancelInstance, eventsInRange, setInstanceStatus } from '../../journal/db/repos/events';
import { listDiaryByDate } from '../../journal/db/repos/diary';
import { formatTrackerValue, listValuesByDate } from '../../journal/db/repos/trackers';
import { addDays, formatDateRu, formatTime } from '../../journal/utils/dates';
import { addWater, guessMealType, loadDietDay } from '../../journal/db/repos/diet';
import { formatAmount } from '../../journal/utils/nutrition';
import { formatKop } from '../../journal/utils/money';
import { listTransactions } from '../../journal/db/repos/finance';
import { SHARE_DAY_SECTIONS, buildDaySummaryText } from '../../journal/share/summaryText';

const KIND_ICONS = { meal: 'restaurant-outline', payment: 'card-outline', note: 'document-text-outline', tracker: 'pulse-outline', custom: 'star-outline' };

const loadDay = async (date) => {
  const [events, diary, values, diet, transactions] = await Promise.all([
    eventsInRange(date, date), listDiaryByDate(date), listValuesByDate(date), loadDietDay(date),
    listTransactions({ from: date, to: date }),
  ]);
  return { events, diary, values, diet, transactions };
};

const DayContent = ({ navigation, date }) => {
  const colors = useColors();
  const { settings } = useJournal();
  const { data } = useJournalQuery(() => loadDay(date), [date]);

  const sections = useMemo(() => {
    if (!data) return [];
    const hasDiet = data.diet.entries.length > 0 || data.diet.waterMl > 0;
    return [
      { key: 'diet', title: 'Питание', data: hasDiet ? [data.diet] : [] },
      { key: 'finance', title: 'Финансы', data: data.transactions },
      { key: 'events', title: 'События', data: data.events },
      { key: 'diary', title: 'Дневник', data: data.diary },
      { key: 'values', title: 'Трекеры', data: data.values },
    ].filter((s) => s.data.length);
  }, [data]);

  const toggleEvent = useCallback(async (inst) => {
    Haptics.selectionAsync().catch(() => undefined);
    await setInstanceStatus(inst, inst.status === 'done' ? 'planned' : 'done');
  }, []);

  const eventMenu = useCallback((inst) => {
    const buttons = [
      { text: 'Изменить событие', onPress: () => navigation.navigate('EventEdit', { uuid: inst.event_uuid }) },
      { text: inst.status === 'skipped' ? 'Вернуть' : 'Пропустить', onPress: () => setInstanceStatus(inst, inst.status === 'skipped' ? 'planned' : 'skipped') },
    ];
    if (inst.recurring) {
      buttons.push({ text: 'Удалить только это', style: 'destructive', onPress: () => cancelInstance(inst) });
    }
    buttons.push({ text: 'Отмена', style: 'cancel' });
    Alert.alert(inst.title, null, buttons);
  }, [navigation]);


  const renderItem = ({ item, section }) => {
    if (section.key === 'diet') {
      return (
        <TouchableOpacity style={[styles.item, { backgroundColor: colors.card }]} onPress={() => navigation.navigate('DietDay', { date })}>
          <Icon name="restaurant-outline" size={22} color={colors.primary} />
          <View style={styles.itemBody}>
            <Text style={[styles.itemTitle, { color: colors.text }]}>
              {formatAmount(item.totals.kcal, 0)} ккал{settings?.kcal_goal ? ` из ${settings.kcal_goal}` : ''}
            </Text>
            <Text style={[styles.itemSub, { color: colors.textSecondary }]}>
              {item.entries.length} зап. · Б {formatAmount(item.totals.protein)} · Ж {formatAmount(item.totals.fat)} · У {formatAmount(item.totals.carbs)}
              {item.waterMl ? ` · вода ${(item.waterMl / 1000).toFixed(2).replace('.', ',')} л` : ''}
            </Text>
          </View>
          <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      );
    }
    if (section.key === 'events') {
      const done = item.status === 'done';
      const skipped = item.status === 'skipped';
      return (
        <TouchableOpacity style={[styles.item, { backgroundColor: colors.card }]} onPress={() => eventMenu(item)}>
          <TouchableOpacity onPress={() => toggleEvent(item)} hitSlop={10}>
            <Icon name={done ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={done ? colors.success : colors.textSecondary} />
          </TouchableOpacity>
          <View style={styles.itemBody}>
            <Text style={[styles.itemTitle, { color: colors.text }, (done || skipped) && styles.strike]} numberOfLines={2}>{item.title}</Text>
            <Text style={[styles.itemSub, { color: colors.textSecondary }]}>
              {item.time ? formatTime(item.time) : 'весь день'}{item.recurring ? ' · повторяется' : ''}{skipped ? ' · пропущено' : ''}
            </Text>
          </View>
          <Icon name={KIND_ICONS[item.kind] || 'star-outline'} size={18} color={item.color || colors.textSecondary} />
        </TouchableOpacity>
      );
    }
    if (section.key === 'finance') {
      return (
        <TouchableOpacity style={[styles.item, { backgroundColor: colors.card }]} onPress={() => navigation.navigate('TransactionEdit', { uuid: item.uuid })}>
          <Icon name={item.direction === 'expense' ? 'arrow-up-circle-outline' : 'arrow-down-circle-outline'} size={22}
            color={item.direction === 'expense' ? colors.error : colors.success} />
          <View style={styles.itemBody}>
            <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>{item.description}</Text>
            <Text style={[styles.itemSub, { color: colors.textSecondary }]}>{item.category_name || item.account_name || 'Операция'}</Text>
          </View>
          <Text style={{ color: item.direction === 'expense' ? colors.error : colors.success }}>
            {item.direction === 'expense' ? '−' : '+'}{formatKop(item.amount_kop)}
          </Text>
        </TouchableOpacity>
      );
    }
    if (section.key === 'diary') {
      const mood = MOODS.find((m) => m.value === item.mood);
      return (
        <TouchableOpacity style={[styles.item, { backgroundColor: colors.card }]} onPress={() => navigation.navigate('DiaryEdit', { uuid: item.uuid })}>
          <Icon name={mood ? mood.icon : 'book-outline'} size={22} color={mood ? mood.color : colors.primary} />
          <View style={styles.itemBody}>
            <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>{item.title || formatTime(item.entry_time) || 'Запись'}</Text>
            {!!item.body && <Text style={[styles.itemSub, { color: colors.textSecondary }]} numberOfLines={2}>{item.body}</Text>}
          </View>
        </TouchableOpacity>
      );
    }
    return (
      <View style={[styles.item, { backgroundColor: colors.card }]}>
        <Icon name={item.tracker_icon || 'pulse-outline'} size={22} color={item.tracker_color || colors.primary} />
        <View style={styles.itemBody}>
          <Text style={[styles.itemTitle, { color: colors.text }]}>{item.tracker_name}</Text>
          {!!item.note && <Text style={[styles.itemSub, { color: colors.textSecondary }]} numberOfLines={1}>{item.note}</Text>}
        </View>
        <Text style={[styles.value, { color: colors.text }]}>{formatTrackerValue(item, item)}</Text>
      </View>
    );
  };

  const footer = (
    <View style={styles.actions}>
      <ActionButton
        colors={colors}
        icon="restaurant-outline"
        label="Еда"
        onPress={() => navigation.navigate('FoodSearch', { date, mealTypeUuid: guessMealType(data?.diet?.mealTypes)?.uuid || null })}
      />
      <ActionButton
        colors={colors}
        icon="water-outline"
        label="+250 мл"
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
          addWater(date, 250);
        }}
      />
      <ActionButton colors={colors} icon="add-circle-outline" label="Событие" onPress={() => navigation.navigate('EventEdit', { date })} />
      <ActionButton colors={colors} icon="book-outline" label="Запись" onPress={() => navigation.navigate('DiaryEdit', { date })} />
      <ActionButton colors={colors} icon="remove-circle-outline" label="Расход" onPress={() => navigation.navigate('TransactionEdit', { direction: 'expense', date })} />
    </View>
  );

  const shareRow = (
    <View style={styles.actions}>
      <ShareButton
        variant="action"
        navigation={navigation}
        icon="share-social-outline"
        label="Поделиться"
        text={buildDaySummaryText(data || {}, date, SHARE_DAY_SECTIONS.map((s) => s.key))}
        route="ShareSummary"
        params={{ kind: 'day', date, data }}
      />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionList
        sections={sections}
        keyExtractor={(item, index) => `${item.uuid || item.event_uuid}:${item.original_date || ''}:${index}`}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{section.title}</Text>
        )}
        ListEmptyComponent={data ? (
          <EmptyState icon="calendar-clear-outline" title="В этот день пока пусто" subtitle="Добавьте событие или запись дневника" />
        ) : null}
        ListFooterComponent={<View>{footer}{shareRow}</View>}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 32 }}
      />

    </View>
  );
};

const ActionButton = ({ colors, icon, label, onPress }) => (
  <TouchableOpacity style={[styles.action, { borderColor: colors.border, backgroundColor: colors.card }]} onPress={onPress}>
    <Icon name={icon} size={20} color={colors.primary} />
    <Text style={{ color: colors.text, marginTop: 4, fontSize: 13 }}>{label}</Text>
  </TouchableOpacity>
);

export default function JournalDayScreen({ navigation, route }) {
  const date = route.params?.date;
  const colors = useColors();
  useLayoutEffect(() => {
    navigation.setOptions({
      title: formatDateRu(date, { withYear: false }),
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity hitSlop={8} onPress={() => navigation.setParams({ date: addDays(date, -1) })}>
            <Icon name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity hitSlop={8} style={{ marginLeft: 12 }} onPress={() => navigation.setParams({ date: addDays(date, 1) })}>
            <Icon name="chevron-forward" size={24} color={colors.text} />
          </TouchableOpacity>
          <SyncBadge />
        </View>
      ),
    });
  }, [navigation, date, colors]);
  return (
    <JournalGate navigation={navigation}>
      <DayContent navigation={navigation} date={date} />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginTop: 16, marginBottom: 6, marginHorizontal: 16 },
  item: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 6, borderRadius: 12, padding: 12 },
  itemBody: { flex: 1, marginHorizontal: 12 },
  itemTitle: { fontSize: 16 },
  itemSub: { fontSize: 13, marginTop: 2 },
  strike: { textDecorationLine: 'line-through', opacity: 0.6 },
  value: { fontSize: 15, fontWeight: '600' },
  actions: { flexDirection: 'row', marginHorizontal: 8, marginTop: 16 },
  action: { flex: 1, marginHorizontal: 3, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
});
