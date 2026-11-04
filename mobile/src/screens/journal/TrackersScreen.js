import React, { useLayoutEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useJournalQuery } from '../../context/JournalContext';
import { EmptyState, HeaderButton, JournalGate, PrimaryButton, useColors } from '../../components/journal/common';
import { formatTrackerValue, goalStatus, listTrackers } from '../../journal/db/repos/trackers';
import { formatDateShort } from '../../journal/utils/dates';
import { isHealthAvailable, isHealthEnabled, runHealthImport } from '../../journal/health/healthImport';

const TrackersContent = ({ navigation }) => {
  const colors = useColors();
  const { data: trackers } = useJournalQuery(() => listTrackers({ includeArchived: true }), []);
  const [syncing, setSyncing] = useState(false);

  const syncHealth = async () => {
    if (!isHealthAvailable()) {
      Alert.alert('Недоступно', 'Синхронизация с «Здоровьем» недоступна в этой сборке приложения');
      return;
    }
    if (!(await isHealthEnabled())) {
      Alert.alert('Импорт выключен', 'Включите импорт из «Здоровья» в настройках журнала');
      return;
    }
    setSyncing(true);
    try {
      const count = await runHealthImport();
      Alert.alert('Синхронизация завершена', `Добавлено новых значений: ${count}`);
    } catch (e) {
      Alert.alert('Ошибка синхронизации', e?.message || 'Не удалось прочитать данные');
    } finally {
      setSyncing(false);
    }
  };

  const renderItem = ({ item }) => {
    const goal = goalStatus(item, item.last_num);
    return (
      <TouchableOpacity
        style={[styles.item, { backgroundColor: 'transparent', borderColor: colors.border, opacity: item.archived ? 0.5 : 1 }]}
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
          {goal && (
            <Text style={[styles.sub, { color: goal.reached ? colors.success : colors.textSecondary }]}>
              {`${goal.direction === 'not_exceed' ? 'Не больше ' : 'Цель '}${formatTrackerValue(item, { num_value: goal.goal })}`}
              {goal.hasValue ? (goal.reached ? ' · достигнута ✓' : ' · пока не достигнута') : ''}
            </Text>
          )}
        </View>
        <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={trackers || []}
        keyExtractor={(t) => t.uuid}
        renderItem={renderItem}
        contentContainerStyle={{ paddingVertical: 8, flexGrow: 1 }}
        ListHeaderComponent={(
          <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
            <PrimaryButton title={syncing ? 'Синхронизация…' : 'Синхронизировать с Здоровьем'} onPress={syncHealth} disabled={syncing} />
            <TouchableOpacity onPress={() => navigation.navigate('HealthImport')} style={{ alignItems: 'center', paddingVertical: 10 }}>
              <Text style={{ color: colors.primary, fontWeight: '600' }}>Импорт из Здоровья: настройки ›</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={trackers ? (
          <EmptyState
            icon="pulse-outline"
            title="Трекеров пока нет"
            subtitle="Трекеры импортируются из приложения «Здоровье» телефона"
          />
        ) : null}
      />
    </View>
  );
};

export default function TrackersScreen({ navigation }) {
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderButton icon="sparkles-outline" onPress={() => navigation.navigate('AiAnalysis', { areas: ['trackers'] })} />
      ),
    });
  }, [navigation]);
  return (
    <JournalGate navigation={navigation}>
      <TrackersContent navigation={navigation} />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginVertical: 4, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, marginHorizontal: 12 },
  name: { fontSize: 16, fontWeight: '500' },
  sub: { fontSize: 13, marginTop: 2 },
});
