import React, { useLayoutEffect, useState } from 'react';
import {
  Alert, FlatList, KeyboardAvoidingView, Modal, Platform, StyleSheet, Switch, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useJournalQuery } from '../../context/JournalContext';
import { EmptyState, HeaderButton, Input, JournalGate, PrimaryButton, useColors } from '../../components/journal/common';
import { TimeField } from '../../components/journal/DateTimeFields';
import { deleteMealType, listMealTypes, saveMealType } from '../../journal/db/repos/diet';
import { ensureReminderPermission } from '../../journal/notifications/permissions';
import { formatTime } from '../../journal/utils/dates';

const mealData = (m, patch = {}) => ({
  name: m.name,
  default_time: m.default_time || null,
  icon: m.icon || null,
  sort_order: m.sort_order || 0,
  reminder_enabled: !!m.reminder_enabled,
  ...patch,
});

// Правка/создание типа приёма пищи (название + время)
const MealTypeModal = ({ visible, meal, onClose, nextOrder }) => {
  const colors = useColors();
  const [name, setName] = useState('');
  const [time, setTime] = useState(null);
  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState(0);

  React.useEffect(() => {
    if (!visible) return;
    setName(meal?.name || '');
    setTime(meal?.default_time ? formatTime(meal.default_time) : null);
    setKey((k) => k + 1);
  }, [visible, meal]);

  const save = async () => {
    if (!name.trim()) return Alert.alert('Укажите название');
    setSaving(true);
    try {
      if (meal) {
        await saveMealType(mealData(meal, {
          name: name.trim(), default_time: time, reminder_enabled: !!meal.reminder_enabled && !!time,
        }), meal.uuid);
      } else {
        await saveMealType({ name: name.trim(), default_time: time, icon: 'restaurant-outline', sort_order: nextOrder, reminder_enabled: false });
      }
      onClose();
    } catch (e) {
      Alert.alert('Не удалось сохранить', e?.message || '');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>{meal ? 'Приём пищи' : 'Новый приём пищи'}</Text>
          <Input value={name} onChangeText={setName} placeholder="Название, например «Второй завтрак»" maxLength={100} autoFocus={!meal} />
          <Text style={{ color: colors.textSecondary, marginTop: 12, marginBottom: 6, fontSize: 13 }}>Обычное время (для напоминания)</Text>
          <TimeField key={key} value={time} onChange={setTime} placeholder="ЧЧ:ММ" />
          <PrimaryButton title="Сохранить" onPress={save} loading={saving} style={{ marginHorizontal: 0 }} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const Content = ({ navigation }) => {
  const colors = useColors();
  const { data: meals } = useJournalQuery(() => listMealTypes(), []);
  const [editing, setEditing] = useState(null); // { meal } | { meal: null }

  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: () => <HeaderButton icon="add" onPress={() => setEditing({ meal: null })} /> });
  }, [navigation]);

  // Напоминание срабатывает каждый день в время приёма пищи (если за этот приём ещё ничего не записано)
  const toggleReminder = async (meal, value) => {
    if (value) {
      if (!meal.default_time) {
        Alert.alert('Укажите время', 'Чтобы включить напоминание, задайте время приёма пищи');
        setEditing({ meal });
        return;
      }
      // Объяснение и запрос разрешений; настройка сохраняется в любом случае (сработает после выдачи)
      await ensureReminderPermission();
    }
    await saveMealType(mealData(meal, { reminder_enabled: value }), meal.uuid);
  };

  const remove = (meal) => {
    Alert.alert(`Удалить «${meal.name}»?`, 'Записи о еде останутся, но будут без приёма пищи.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => deleteMealType(meal.uuid) },
    ]);
  };

  const nextOrder = Math.max(0, ...(meals || []).map((m) => m.sort_order || 0)) + 10;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={meals || []}
        keyExtractor={(m) => m.uuid}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.row, { backgroundColor: 'transparent' }]}
            onPress={() => setEditing({ meal: item })}
            onLongPress={() => remove(item)}
          >
            <Icon name={item.icon || 'restaurant-outline'} size={22} color={colors.primary} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: colors.text, fontSize: 16 }}>{item.name}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                {item.default_time ? formatTime(item.default_time) : 'время не задано'}
                {item.reminder_enabled ? ' · напоминание каждый день' : ''}
              </Text>
            </View>
            <Switch value={!!item.reminder_enabled} onValueChange={(v) => toggleReminder(item, v)} />
          </TouchableOpacity>
        )}
        ListHeaderComponent={(
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            Включите напоминание - оно придёт точно в указанное время, даже без интернета. Если за приём пищи уже есть запись, напоминание не придёт. Долгое нажатие - удалить.
          </Text>
        )}
        ListEmptyComponent={meals ? <EmptyState icon="restaurant-outline" title="Нет приёмов пищи" actionLabel="Добавить" onAction={() => setEditing({ meal: null })} /> : null}
        contentContainerStyle={{ paddingBottom: 32 }}
      />
      <MealTypeModal visible={!!editing} meal={editing?.meal || null} nextOrder={nextOrder} onClose={() => setEditing(null)} />
    </View>
  );
};

export default function MealTypesScreen({ navigation }) {
  return (
    <JournalGate navigation={navigation}>
      <Content navigation={navigation} />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, marginHorizontal: 16, marginVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 6, borderRadius: 12, padding: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 32 },
  sheetTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
});
