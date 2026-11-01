import React, { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useJournal, useJournalQuery } from '../../context/JournalContext';
import { Chip, Field, Input, JournalGate, PrimaryButton, Section, useColors } from '../../components/journal/common';
import { updateSettings } from '../../journal/db/repos/settings';
import {
  discardRejectedChanges, fullResync, listRejectedChanges, retryRejectedChanges,
} from '../../journal/sync/syncEngine';
import { deviceTimeZone } from '../../journal/utils/dates';

const isValidTimeZone = (tz) => {
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const STATUS_TEXT = {
  idle: 'Синхронизировано',
  syncing: 'Синхронизация…',
  offline: 'Нет сети - изменения сохранены на устройстве',
  error: 'Ошибка синхронизации',
  auth: 'Требуется вход',
};

const formatDateTime = (iso) => {
  if (!iso) return 'ещё не было';
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
};

const SettingsContent = () => {
  const colors = useColors();
  const { settings, syncState, syncNow } = useJournal();
  const [tz, setTz] = useState(settings?.timezone || deviceTimeZone());
  const [heightCm, setHeightCm] = useState(settings?.height_cm ? String(settings.height_cm) : '');
  const [weightKg, setWeightKg] = useState(settings?.weight_kg != null ? String(settings.weight_kg) : '');
  const { data: rejected } = useJournalQuery(() => listRejectedChanges(), [syncState.status]);
  const device = deviceTimeZone();
  const navigation = useNavigation();

  useEffect(() => {
    if (settings?.timezone) setTz(settings.timezone);
  }, [settings?.timezone]);

  useEffect(() => {
    setHeightCm(settings?.height_cm ? String(settings.height_cm) : '');
    setWeightKg(settings?.weight_kg != null ? String(settings.weight_kg) : '');
  }, [settings?.height_cm, settings?.weight_kg]);

  const saveBodyMetrics = async () => {
    const h = heightCm.trim() ? Number(heightCm.replace(',', '.')) : null;
    const w = weightKg.trim() ? Number(weightKg.replace(',', '.')) : null;
    if ((h !== null && (!Number.isInteger(h) || h < 50 || h > 260)) || (w !== null && (!(w >= 30) || w > 300))) {
      Alert.alert('Проверьте значения', 'Рост - целое число см (50-260), вес - в кг (30-300)');
      return;
    }
    await updateSettings({ height_cm: h, weight_kg: w !== null ? Math.round(w * 10) / 10 : null });
  };

  const saveTz = async (value) => {
    const v = value.trim();
    if (!isValidTimeZone(v)) {
      Alert.alert('Неизвестный часовой пояс', 'Укажите пояс в формате IANA, например Europe/Moscow');
      return;
    }
    await updateSettings({ timezone: v });
  };

  const confirmResync = () => {
    Alert.alert(
      'Полная синхронизация',
      'Данные журнала будут заново загружены с сервера. Неотправленные изменения сохранятся.',
      [{ text: 'Отмена', style: 'cancel' }, { text: 'Загрузить', onPress: () => fullResync() }],
    );
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Section title="Синхронизация">
        <View style={styles.row}>
          <Icon
            name={syncState.status === 'error' || syncState.status === 'auth' ? 'warning-outline' : syncState.status === 'offline' ? 'cloud-offline-outline' : 'cloud-done-outline'}
            size={20}
            color={syncState.status === 'error' ? colors.error : colors.primary}
          />
          <Text style={[styles.rowText, { color: colors.text }]}>{STATUS_TEXT[syncState.status] || ''}</Text>
        </View>
        {!!syncState.lastError && <Text style={[styles.note, { color: colors.error }]}>{syncState.lastError}</Text>}
        <Text style={[styles.note, { color: colors.textSecondary }]}>Ожидают отправки: {syncState.pending || 0}</Text>
        <Text style={[styles.note, { color: colors.textSecondary }]}>Последняя синхронизация: {formatDateTime(syncState.lastSyncAt)}</Text>
        <View style={styles.buttons}>
          <TouchableOpacity style={[styles.smallButton, { borderColor: colors.primary }]} onPress={() => syncNow()}>
            <Text style={{ color: colors.primary }}>Синхронизировать</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.smallButton, { borderColor: colors.border }]} onPress={confirmResync}>
            <Text style={{ color: colors.text }}>Загрузить заново</Text>
          </TouchableOpacity>
        </View>
      </Section>

      {!!rejected?.length && (
        <Section title="Не приняты сервером">
          {rejected.slice(0, 5).map((r) => (
            <Text key={`${r.entity}:${r.uuid}`} style={[styles.note, { color: colors.textSecondary }]}>
              {r.entity} · {r.last_error || 'ошибка'}
            </Text>
          ))}
          <View style={styles.buttons}>
            <TouchableOpacity style={[styles.smallButton, { borderColor: colors.primary }]} onPress={() => retryRejectedChanges()}>
              <Text style={{ color: colors.primary }}>Повторить</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.smallButton, { borderColor: colors.error }]} onPress={() => discardRejectedChanges()}>
              <Text style={{ color: colors.error }}>Отбросить</Text>
            </TouchableOpacity>
          </View>
        </Section>
      )}

      <Section title="Питание">
        <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('NutritionGoals')}>
          <Icon name="flag-outline" size={20} color={colors.primary} />
          <Text style={[styles.rowText, { color: colors.text }]}>Цели по КБЖУ и воде</Text>
          <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('MealTypes')}>
          <Icon name="restaurant-outline" size={20} color={colors.primary} />
          <Text style={[styles.rowText, { color: colors.text }]}>Приёмы пищи и напоминания</Text>
          <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </Section>

      <Section title="Аналитика">
        <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('AiAnalysis')}>
          <Icon name="sparkles-outline" size={20} color={colors.primary} />
          <Text style={[styles.rowText, { color: colors.text }]}>ИИ-аналитика по сферам</Text>
        </TouchableOpacity>
      </Section>

      <Section title="Здоровье">
        <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('HealthImport')}>
          <Icon name="heart-outline" size={20} color={colors.primary} />
          <Text style={[styles.rowText, { color: colors.text }]}>Импорт из Здоровья</Text>
          <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </Section>

      <Section title="Напоминания">
        <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('ReminderDiagnostics')}>
          <Icon name="notifications-outline" size={20} color={colors.primary} />
          <Text style={[styles.rowText, { color: colors.text }]}>Проверка напоминаний</Text>
          <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        {Platform.OS === 'android' && (
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('BatteryHelp')}>
            <Icon name="battery-charging-outline" size={20} color={colors.primary} />
            <Text style={[styles.rowText, { color: colors.text }]}>Экономия батареи</Text>
            <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </Section>

      <Section title="Часовой пояс">
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          Время событий и напоминаний считается в этом поясе. На устройстве сейчас: {device}
        </Text>
        <Field>
          <Input value={tz} onChangeText={setTz} autoCapitalize="none" autoCorrect={false} placeholder="Europe/Moscow" onEndEditing={() => tz !== settings?.timezone && saveTz(tz)} />
        </Field>
        {settings?.timezone !== device && (
          <PrimaryButton title={`Использовать ${device}`} onPress={() => saveTz(device)} style={{ marginTop: 12 }} />
        )}
        <View style={{ height: 12 }} />
      </Section>

      <Section title="Рост и вес">
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          Нужны для расчёта нормы калорий и БЖУ в целях по питанию.
        </Text>
        <Field label="Рост, см">
          <Input value={heightCm} onChangeText={setHeightCm} keyboardType="number-pad" placeholder="175" onEndEditing={saveBodyMetrics} />
        </Field>
        <Field label="Вес, кг">
          <Input value={weightKg} onChangeText={setWeightKg} keyboardType="decimal-pad" placeholder="70.5" onEndEditing={saveBodyMetrics} />
        </Field>
        <View style={{ height: 12 }} />
      </Section>

      <Section title="Первый день недели">
        <View style={[styles.wrap, { paddingHorizontal: 12, paddingTop: 4 }]}>
          <Chip label="Понедельник" selected={(settings?.week_start || 1) === 1} onPress={() => updateSettings({ week_start: 1 })} />
          <Chip label="Воскресенье" selected={settings?.week_start === 7} onPress={() => updateSettings({ week_start: 7 })} />
        </View>
      </Section>

      <Text style={[styles.footer, { color: colors.textSecondary }]}>
        Записи журнала хранятся на устройстве и доступны без сети. Изменения отправляются на сервер автоматически, когда появляется связь.
      </Text>
    </ScrollView>
  );
};

export default function JournalSettingsScreen({ navigation }) {
  return (
    <JournalGate navigation={navigation}>
      <SettingsContent />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  rowText: { flex: 1, fontSize: 16, marginLeft: 10 },
  note: { fontSize: 13, paddingHorizontal: 12, paddingVertical: 2 },
  buttons: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  smallButton: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  footer: { fontSize: 13, marginHorizontal: 20, marginTop: 20, textAlign: 'center' },
});
