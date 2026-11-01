import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { JournalGate, PrimaryButton, Section, useColors } from '../../components/journal/common';
import { useJournalQuery } from '../../context/JournalContext';
import { listAccounts } from '../../journal/db/repos/finance';

const FIELDS = [
  ['date', 'Дата'], ['amount', 'Сумма'], ['debit', 'Дебет / расход'], ['credit', 'Кредит / доход'],
  ['description', 'Описание'], ['merchant', 'Контрагент'], ['type', 'Тип'], ['currency', 'Валюта'], ['external_id', 'ID операции'],
];

function Content({ navigation, route }) {
  const colors = useColors();
  const preview = route.params?.preview;
  const { data: accounts } = useJournalQuery(listAccounts, []);
  const [accountUuid, setAccountUuid] = useState('');
  const [mapping, setMapping] = useState(() => Object.fromEntries(
    Object.entries(preview?.suggested_mapping || {}).filter(([, index]) => index !== null),
  ));
  const continueToPreview = () => {
    if (!accountUuid || mapping.date === undefined || (mapping.amount === undefined && mapping.debit === undefined && mapping.credit === undefined)) {
      Alert.alert('Нужно сопоставить данные', 'Выберите счёт, дату и сумму либо колонки дебета/кредита.');
      return;
    }
    navigation.navigate('ImportPreview', { preview, accountUuid, mapping });
  };
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 32 }}>
    <Section title="Файл"><Text style={{ color: colors.text, padding: 12 }}>{preview?.filename} · {preview?.row_count} строк</Text></Section>
    <Section title="Счёт"><Picker selectedValue={accountUuid} onValueChange={setAccountUuid}>
      <Picker.Item label="Выберите счёт" value="" />
      {(accounts || []).map((item) => <Picker.Item key={item.uuid} label={item.name} value={item.uuid} />)}
    </Picker></Section>
    <Section title="Сопоставление колонок">{FIELDS.map(([field, label]) => (
      <View key={field} style={{ paddingHorizontal: 12, paddingTop: 6 }}>
        <Text style={{ color: colors.textSecondary }}>{label}</Text>
        <Picker selectedValue={mapping[field] ?? ''} onValueChange={(value) => setMapping((current) => {
          const next = { ...current };
          if (value === '') delete next[field]; else next[field] = Number(value);
          return next;
        })}>
          <Picker.Item label="Не использовать" value="" />
          {(preview?.headers || []).map((header, index) => <Picker.Item key={`${field}:${index}`} label={header || `Колонка ${index + 1}`} value={index} />)}
        </Picker>
      </View>
    ))}</Section>
    <PrimaryButton title="Показать предпросмотр" onPress={continueToPreview} />
  </ScrollView>;
}
export default function ImportMappingScreen({ navigation, route }) { return <JournalGate navigation={navigation}><Content navigation={navigation} route={route} /></JournalGate>; }
