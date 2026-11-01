import React, { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { JournalGate, PrimaryButton, Section, useColors } from '../../components/journal/common';
import { useJournalQuery } from '../../context/JournalContext';
import { listAccounts, saveAccount } from '../../journal/db/repos/finance';
import { formatKop } from '../../journal/utils/money';
import MoneyInput from '../../components/journal/MoneyInput';

function Content() {
  const colors = useColors();
  const { data: accounts } = useJournalQuery(listAccounts, []);
  const [name, setName] = useState('');
  const [openingKop, setOpeningKop] = useState(0);
  const add = async () => {
    if (!name.trim()) return;
    await saveAccount({ name: name.trim(), kind: 'bank', currency: 'RUB', opening_balance_kop: openingKop || 0 });
    setName(''); setOpeningKop(0);
  };
  const inputStyle = { color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12, marginVertical: 5 };
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 32 }}>
    <Section title="Мои счета">{(accounts || []).map((account) => <View key={account.uuid} style={{ padding: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: colors.text }}>{account.name}</Text><Text style={{ color: colors.text }}>{formatKop(account.balance_kop)}</Text>
    </View>)}</Section>
    <Section title="Добавить счёт"><View style={{ paddingHorizontal: 12 }}>
      <TextInput value={name} onChangeText={setName} placeholder="Название счёта" placeholderTextColor={colors.textSecondary} style={inputStyle} />
      <MoneyInput value={openingKop} onChangeKop={setOpeningKop} style={inputStyle} placeholder="Начальный баланс, ₽" />
      <PrimaryButton title="Добавить счёт" onPress={add} disabled={!name.trim()} />
    </View></Section>
  </ScrollView>;
}
export default function AccountsScreen({ navigation }) { return <JournalGate navigation={navigation}><Content /></JournalGate>; }
