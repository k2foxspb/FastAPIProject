import React, { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import MoneyInput from '../../components/journal/MoneyInput';
import { JournalGate, PrimaryButton, Section, useColors } from '../../components/journal/common';
import { useJournal, useJournalQuery } from '../../context/JournalContext';
import { listBudgets, listFinanceCategories, saveBudget } from '../../journal/db/repos/finance';
import { formatKop } from '../../journal/utils/money';

function Content() {
  const colors = useColors();
  const { today } = useJournal();
  const month = today.slice(0, 7);
  const { data: budgets } = useJournalQuery(() => listBudgets(month), [month]);
  const { data: categories } = useJournalQuery(() => listFinanceCategories('expense'), []);
  const [categoryUuid, setCategoryUuid] = useState('');
  const [limitKop, setLimitKop] = useState(null);
  const [periodMonth, setPeriodMonth] = useState(month);
  const add = async () => {
    if (!limitKop) return;
    await saveBudget({ category_uuid: categoryUuid || null, period_month: periodMonth, limit_kop: limitKop, enabled: true });
    setLimitKop(null);
  };
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 32 }}>
    <Section title={`Бюджеты · ${month}`}>{(budgets || []).map((budget) => (
      <View key={budget.uuid} style={{ padding: 12 }}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{budget.category_name}</Text>
        <Text style={{ color: colors.textSecondary, marginTop: 4 }}>{formatKop(budget.spent_kop)} из {formatKop(budget.limit_kop)}</Text>
      </View>
    ))}</Section>
    <Section title="Новый бюджет"><View style={{ paddingHorizontal: 12 }}>
      <Picker selectedValue={categoryUuid} onValueChange={setCategoryUuid}>
        <Picker.Item label="Все расходы" value="" />
        {(categories || []).map((category) => <Picker.Item key={category.uuid} label={category.name} value={category.uuid} />)}
      </Picker>
      <TextInput value={periodMonth} onChangeText={setPeriodMonth} placeholder="ГГГГ-ММ" placeholderTextColor={colors.textSecondary}
        style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12 }} />
      <View style={{ marginTop: 10 }}><MoneyInput value={limitKop} onChangeKop={setLimitKop} /></View>
      <PrimaryButton title="Сохранить бюджет" onPress={add} disabled={!limitKop} />
    </View></Section>
  </ScrollView>;
}
export default function BudgetsScreen({ navigation }) { return <JournalGate navigation={navigation}><Content /></JournalGate>; }
