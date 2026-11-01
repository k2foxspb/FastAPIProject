import React, { useCallback, useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { JournalGate, PrimaryButton, Section, useColors } from '../../components/journal/common';
import {
  getReminderPermissions, openExactAlarmSettings, openNotificationSettings, requestNotificationPermission,
} from '../../journal/notifications/permissions';
import { getSchedulerInfo, rescheduleAll, scheduleTestNotification } from '../../journal/notifications/scheduler';

const formatFire = (ms) => {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return String(ms);
  }
};

// Строка статуса: зелёная галочка / красное предупреждение + кнопка исправления
const StatusRow = ({ ok, warn, title, subtitle, actionLabel, onAction }) => {
  const colors = useColors();
  const color = ok ? '#2E7D32' : warn ? '#F59E0B' : colors.error;
  return (
    <View style={styles.statusRow}>
      <Icon name={ok ? 'checkmark-circle' : 'alert-circle'} size={22} color={color} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={[styles.statusTitle, { color: colors.text }]}>{title}</Text>
        {!!subtitle && <Text style={[styles.note, { color: colors.textSecondary, paddingHorizontal: 0 }]}>{subtitle}</Text>}
      </View>
      {!!actionLabel && (
        <TouchableOpacity style={[styles.smallButton, { borderColor: colors.primary }]} onPress={onAction}>
          <Text style={{ color: colors.primary }}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const DiagnosticsContent = ({ navigation }) => {
  const colors = useColors();
  const [perm, setPerm] = useState(null);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, i] = await Promise.all([getReminderPermissions(), getSchedulerInfo()]);
      setPerm(p);
      setInfo(i);
    } catch (e) {
      console.log('[JournalReminders] diagnostics error', e?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Возврат из системных настроек - перечитываем статус и пересчитываем окно
  useFocusEffect(useCallback(() => {
    rescheduleAll().finally(load);
  }, [load]));

  const requestNotifications = async () => {
    if (perm?.notifications === 'denied') await openNotificationSettings();
    else await requestNotificationPermission();
    await rescheduleAll();
    load();
  };

  const sendTest = async () => {
    try {
      const at = await scheduleTestNotification();
      Alert.alert('Тест запланирован', `Уведомление придёт в ${formatFire(at)}. Можно заблокировать экран или закрыть приложение.`);
      load();
    } catch (e) {
      Alert.alert('Не удалось запланировать', e?.message || '');
    }
  };

  const notifOk = perm?.notifications === 'granted';
  const exactOk = perm?.exactAlarm !== 'disabled';
  const batteryOk = perm?.batteryOptimization !== true;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      {perm && (!notifOk || !exactOk) && (
        <View style={[styles.banner, { backgroundColor: '#F59E0B22', borderColor: '#F59E0B' }]}>
          <Icon name="warning-outline" size={20} color="#F59E0B" />
          <Text style={[styles.bannerText, { color: colors.text }]}>
            {!notifOk ? 'Уведомления запрещены - напоминания не появятся.' : 'Напоминания могут приходить с задержкой.'}
          </Text>
        </View>
      )}

      <Section title="Разрешения">
        <StatusRow
          ok={notifOk}
          title="Уведомления"
          subtitle={notifOk ? 'Разрешены' : perm?.notifications === 'denied' ? 'Запрещены в настройках' : 'Ещё не запрошены'}
          actionLabel={notifOk ? null : perm?.notifications === 'denied' ? 'Открыть' : 'Разрешить'}
          onAction={requestNotifications}
        />
        {Platform.OS === 'android' && (
          <StatusRow
            ok={exactOk}
            warn={!exactOk}
            title="Точные будильники"
            subtitle={perm?.exactAlarm === 'enabled' ? 'Разрешены - напоминания приходят минута в минуту'
              : perm?.exactAlarm === 'disabled' ? 'Запрещены - возможна задержка' : 'Не требуются на этой версии Android'}
            actionLabel={exactOk ? null : 'Разрешить'}
            onAction={openExactAlarmSettings}
          />
        )}
        {Platform.OS === 'android' && (
          <StatusRow
            ok={batteryOk}
            warn={!batteryOk}
            title="Оптимизация батареи"
            subtitle={perm?.batteryOptimization === true ? 'Включена - система может откладывать напоминания'
              : perm?.batteryOptimization === false ? 'Приложение исключено' : 'Неизвестно'}
            actionLabel="Подробнее"
            onAction={() => navigation.navigate('BatteryHelp')}
          />
        )}
      </Section>

      <Section title="Запланировано">
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          Всего: {info?.total ?? '—'} (максимум {info?.max ?? '—'}, окно {info?.windowDays ?? '—'} дн.)
        </Text>
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          Последний пересчёт: {info?.lastRun ? formatFire(Date.parse(info.lastRun)) : 'ещё не было'}
        </Text>
        {(info?.upcoming || []).map((t) => (
          <View key={t.id} style={styles.triggerRow}>
            <Icon name={t.test ? 'flask-outline' : t.snooze ? 'alarm-outline' : 'notifications-outline'} size={18} color={colors.primary} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ color: colors.text }} numberOfLines={1}>{t.title}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }} numberOfLines={1}>{t.body}</Text>
            </View>
            <Text style={{ color: colors.text, fontSize: 13 }}>{formatFire(t.fireAt)}</Text>
          </View>
        ))}
        {info && !info.upcoming.length && (
          <Text style={[styles.note, { color: colors.textSecondary, paddingVertical: 8 }]}>
            Нет запланированных напоминаний. Включите напоминание в событии.
          </Text>
        )}
        <View style={{ height: 8 }} />
      </Section>

      <PrimaryButton title="Тестовое уведомление через минуту" onPress={sendTest} style={{ marginHorizontal: 16, marginTop: 16 }} />
      <PrimaryButton title="Пересчитать напоминания" onPress={() => rescheduleAll().finally(load)} style={{ marginHorizontal: 16, marginTop: 10 }} />
      <Text style={[styles.footer, { color: colors.textSecondary }]}>
        Напоминания хранятся на устройстве и приходят без интернета. Если тест пришёл с опозданием, откройте «Оптимизация батареи».
      </Text>
    </ScrollView>
  );
};

export default function ReminderDiagnosticsScreen({ navigation }) {
  return (
    <JournalGate navigation={navigation}>
      <DiagnosticsContent navigation={navigation} />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  statusTitle: { fontSize: 16 },
  note: { fontSize: 13, paddingHorizontal: 12, paddingVertical: 2 },
  smallButton: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, marginLeft: 8 },
  triggerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  banner: { flexDirection: 'row', alignItems: 'center', margin: 16, marginBottom: 0, padding: 12, borderRadius: 12, borderWidth: 1 },
  bannerText: { flex: 1, marginLeft: 10, fontSize: 14 },
  footer: { fontSize: 13, marginHorizontal: 20, marginTop: 20, textAlign: 'center' },
});
