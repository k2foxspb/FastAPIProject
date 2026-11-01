import React, { useLayoutEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useJournal, useJournalQuery } from '../../context/JournalContext';
import { EmptyState, HeaderButton, JournalGate, useColors } from '../../components/journal/common';
import TrackerValueModal from '../../components/journal/TrackerValueModal';
import { formatTrackerValue, listTrackers } from '../../journal/db/repos/trackers';
import { formatDateShort } from '../../journal/utils/dates';

const TrackersContent = ({ navigation, route }) => {
  const colors = useColors();
  const { today } = useJournal();
  const { data: trackers } = useJournalQuery(() => listTrackers({ includeArchived: true }), []);
  const [quick, setQuick] = useState(null);
  const quickDate = route.params?.quickDate || today;

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={[styles.item, { backgroundColor: colors.card, borderColor: colors.border, opacity: item.archived ? 0.5 : 1 }]}
      onPress={() => navigation.navigate('TrackerDetail', { uuid: item.uuid })}
    >
      <View style={[styles.icon, { backgroundColor: `${item.color || colors.primary}22` }]}>
        <Icon name={item.icon || 'pulse-outline'} size={22} color={item.color || colors.primary} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.name, { color: colors.text }]}>{item.name}{item.archived ? ' (в архиве)' : ''}</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          {item.last_date ? `${formatTrackerValue(item, item)} · ${formatDateShort(item.last_date)}` : 'Нет значений'}
        </Text>
      </View>
      {!item.archived && (
        <TouchableOpacity hitSlop={10} onPress={() => setQuick(item)} style={[styles.add, { backgroundColor: colors.primary }]}>
          <Icon name="add" size={20} color="#fff" />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={trackers || []}
        keyExtractor={(t) => t.uuid}
        renderItem={renderItem}
        contentContainerStyle={{ paddingVertical: 8, flexGrow: 1 }}
        ListEmptyComponent={trackers ? (
          <EmptyState
            icon="pulse-outline"
            title="Трекеров пока нет"
            subtitle="Отслеживайте вес, сон, настроение или привычки"
            actionLabel="Создать трекер"
            onAction={() => navigation.navigate('TrackerEdit', {})}
          />
        ) : null}
      />
      <TrackerValueModal visible={!!quick} tracker={quick} date={quickDate} value={null} onClose={() => setQuick(null)} />
    </View>
  );
};

export default function TrackersScreen({ navigation, route }) {
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <HeaderButton icon="add" onPress={() => navigation.navigate('TrackerEdit', {})} />,
    });
  }, [navigation]);
  return (
    <JournalGate navigation={navigation}>
      <TrackersContent navigation={navigation} route={route} />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginVertical: 4, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, marginHorizontal: 12 },
  name: { fontSize: 16, fontWeight: '500' },
  sub: { fontSize: 13, marginTop: 2 },
  add: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
