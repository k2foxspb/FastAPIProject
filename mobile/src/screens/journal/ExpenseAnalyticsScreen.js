import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useJournal } from '../../context/JournalContext';
import { JournalGate, Section, useColors } from '../../components/journal/common';
import { listTransactions } from '../../journal/db/repos/finance';
import { formatKop } from '../../journal/utils/money';
import { useJournalQuery } from '../../context/JournalContext';

function Content() {
  const colors = useColors();
  const { today } = useJournal();
  const month = today.slice(0, 7);
  const { data: transactions } = useJournalQuery(() => listTransactions({ from: `${month}-01`, to: today, limit: 500 }), [month, today]);
  const totals = {};
  (transactions || []).filter((item) => item.direction === 'expense').forEach((item) => {
    const name = item.category_name || 'Без категории';
    totals[name] = (totals[name] || 0) + Number(item.amount_kop || 0);
  });
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, amount]) => sum + amount, 0);
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 32 }}>
    <Section title={`Расходы за ${month}`}>
      <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700', padding: 12 }}>{formatKop(total)}</Text>
      {sorted.map(([name, amount]) => <View key={name} style={{ padding: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.text }}>{name}</Text><Text style={{ color: colors.error }}>{formatKop(amount)}</Text>
      </View>)}
    </Section>
  </ScrollView>;
}
export default function ExpenseAnalyticsScreen({ navigation }) { return <JournalGate navigation={navigation}><Content /></JournalGate>; }
