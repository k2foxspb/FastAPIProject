import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useJournalQuery } from '../../context/JournalContext';
import { EmptyState, JournalGate, MOODS, SyncBadge, useColors } from '../../components/journal/common';
import TrackerValueModal from '../../components/journal/TrackerValueModal';
import { cancelInstance, eventsInRange, setInstanceStatus } from '../../journal/db/repos/events';
import { listDiaryByDate } from '../../journal/db/repos/diary';
import { deleteTrackerValue, formatTrackerValue, listTrackers, listValuesByDate } from '../../journal/db/repos/trackers';
import { addDays, formatDateRu, formatTime } from '../../journal/utils/dates';

const KIND_ICONS = { meal: 'restaurant-outline', payment: 'card-outline', note: 'document-text-outline', tracker: 'pulse-outline', custom: 'star-outline' };

const loadDay = async (date) => {
  const [events, diary, values] = await Promise.all([eventsInRange(date, date), listDiaryByDate(date), listValuesByDate(date)]);
  return { events, diary, values };
};

const DayContent = ({ navigation, date }) => {
  const colors = useColors();
  const { data } = useJournalQuery(() => loadDay(date), [date]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [valueModal, setValueModal] = useState(null); // { tracker, value }
  const { data: trackers } = useJournalQuery(() => listTrackers(), []);

  const sections = useMemo(() => {
    if (!data) return [];
    return [
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

  const valueMenu = useCallback((value) => {
    Alert.alert(value.tracker_name, null, [
      { text: 'Изменить', onPress: () => setValueModal({ tracker: trackers?.find((t) => t.uuid === value.tracker_uuid), value }) },
      { text: 'Удалить', style: 'destructive', onPress: () => deleteTrackerValue(value.uuid) },
      { text: 'Отмена', style: 'cancel' },
    ]);
  }, [trackers]);

  const renderItem = ({ item, section }) => {
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
      <TouchableOpacity style={[styles.item, { backgroundColor: colors.card }]} onPress={() => valueMenu(item)}>
        <Icon name={item.tracker_icon || 'pulse-outline'} size={22} color={item.tracker_color || colors.primary} />
        <View style={styles.itemBody}>
          <Text style={[styles.itemTitle, { color: colors.text }]}>{item.tracker_name}</Text>
          {!!item.note && <Text style={[styles.itemSub, { color: colors.textSecondary }]} numberOfLines={1}>{item.note}</Text>}
        </View>
        <Text style={[styles.value, { color: colors.text }]}>{formatTrackerValue(item, item)}</Text>
      </TouchableOpacity>
    );
  };

  const footer = (
    <View style={styles.actions}>
      <ActionButton colors={colors} icon="add-circle-outline" label="Событие" onPress={() => navigation.navigate('EventEdit', { date })} />
      <ActionButton colors={colors} icon="book-outline" label="Запись" onPress={() => navigation.navigate('DiaryEdit', { date })} />
      <ActionButton colors={colors} icon="pulse-outline" label="Трекер" onPress={() => setPickerOpen(true)} />
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
          <EmptyState icon="calendar-clear-outline" title="В этот день пока пусто" subtitle="Добавьте событие, запись дневника или значение трекера" />
        ) : null}
        ListFooterComponent={footer}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 32 }}
      />

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <View style={[styles.picker, { backgroundColor: colors.card }]}>
            <Text style={[styles.pickerTitle, { color: colors.text }]}>Какой трекер?</Text>
            <FlatList
              data={trackers || []}
              keyExtractor={(t) => t.uuid}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerRow}
                  onPress={() => {
                    setPickerOpen(false);
                    setValueModal({ tracker: item, value: null });
                  }}
                >
                  <Icon name={item.icon || 'pulse-outline'} size={20} color={item.color || colors.primary} />
                  <Text style={[styles.pickerText, { color: colors.text }]}>{item.name}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={{ color: colors.textSecondary, padding: 12 }}>Трекеров пока нет</Text>}
            />
            <TouchableOpacity
              style={styles.pickerRow}
              onPress={() => {
                setPickerOpen(false);
                navigation.navigate('TrackerEdit', {});
              }}
            >
              <Icon name="add" size={20} color={colors.primary} />
              <Text style={[styles.pickerText, { color: colors.primary }]}>Новый трекер</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <TrackerValueModal
        visible={!!valueModal}
        tracker={valueModal?.tracker}
        value={valueModal?.value}
        date={date}
        onClose={() => setValueModal(null)}
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
  action: { flex: 1, marginHorizontal: 4, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  picker: { borderRadius: 16, paddingVertical: 8, maxHeight: '70%' },
  pickerTitle: { fontSize: 17, fontWeight: '600', paddingHorizontal: 16, paddingVertical: 8 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  pickerText: { fontSize: 16, marginLeft: 12 },
});
