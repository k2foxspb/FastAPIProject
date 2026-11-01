import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { JournalGate, PrimaryButton, Section, useColors } from '../../components/journal/common';
import { HEALTH_METRICS } from '../../journal/health/metrics';
import {
  getEnabledMetrics, isHealthAvailable, isHealthEnabled, requestHealthPermissions, runHealthImport, setHealthSettings,
} from '../../journal/health/healthImport';

const HealthContent = () => {
  const colors = useColors();
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const available = isHealthAvailable();

  useEffect(() => {
    isHealthEnabled().then(setEnabled);
    getEnabledMetrics().then(setSelected);
  }, []);

  const toggleEnabled = async (value) => {
    setEnabled(value);
    await setHealthSettings({ enabled: value });
  };

  const toggleMetric = async (key) => {
    const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    setSelected(next);
    await setHealthSettings({ metrics: next });
  };

  const connect = async () => {
    if (!selected.length) {
      Alert.alert('Выберите метрики', 'Отметьте хотя бы одну метрику для импорта');
      return;
    }
    setBusy(true);
    try {
      const ok = await requestHealthPermissions(selected);
      if (!ok) Alert.alert('Недоступно', 'Модуль здоровья не найден в этой сборке приложения');
    } catch (e) {
      Alert.alert('Ошибка', e?.message || 'Не удалось запросить разрешения');
    } finally {
      setBusy(false);
    }
  };

  const importNow = async () => {
    setBusy(true);
    try {
      const count = await runHealthImport();
      Alert.alert('Импорт завершён', `Добавлено новых записей: ${count}`);
    } catch (e) {
      Alert.alert('Ошибка импорта', e?.message || 'Не удалось прочитать данные');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 40 }}>
      <Section title="Импорт">
        <View style={styles.row}>
          <Text style={[styles.rowText, { color: colors.text }]}>Импорт из Здоровья</Text>
          <Switch value={enabled} onValueChange={toggleEnabled} disabled={!available} />
        </View>
        {!available && (
          <Text style={[styles.note, { color: colors.textSecondary }]}>
            Недоступно в этой сборке: нужен dev-client с нативными модулями Health Connect или HealthKit.
          </Text>
        )}
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          Выключено по умолчанию. Данные читаются только при включении и не отправляются на сервер.
        </Text>
      </Section>

      <Section title="Метрики">
        {HEALTH_METRICS.map((m) => (
          <View key={m.key} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowText, { color: colors.text }]}>{m.title}</Text>
              <Text style={[styles.note, { color: colors.textSecondary, paddingHorizontal: 0 }]}>{m.hint}</Text>
            </View>
            <Switch value={selected.includes(m.key)} onValueChange={() => toggleMetric(m.key)} disabled={!enabled} />
          </View>
        ))}
      </Section>

      <View style={{ paddingHorizontal: 12, marginTop: 12 }}>
        <PrimaryButton title="Выдать разрешения" onPress={connect} disabled={busy || !enabled || !available} />
        <View style={{ height: 10 }} />
        <PrimaryButton title="Импортировать сейчас" onPress={importNow} disabled={busy || !enabled || !available} />
      </View>
    </ScrollView>
  );
};

export default function HealthImportScreen({ navigation }) {
  return (
    <JournalGate navigation={navigation}>
      <HealthContent />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  rowText: { flex: 1, fontSize: 16 },
  note: { fontSize: 13, paddingHorizontal: 12, paddingVertical: 2 },
});
