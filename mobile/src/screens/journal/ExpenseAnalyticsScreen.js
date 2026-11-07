import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useJournal } from '../../context/JournalContext';
import { JournalGate, Section, useColors } from '../../components/journal/common';
import { monthTotals } from '../../journal/db/repos/finance';
import { financeByCategory } from '../../journal/db/repos/analytics';
import { formatKop } from '../../journal/utils/money';
import { useJournalQuery } from '../../context/JournalContext';

function Content() {
  const colors = useColors();
  const { today } = useJournal();
  const month = today.slice(0, 7);
  const { data } = useJournalQuery(async () => {
    const [totals, incomeCategories, expenseCategories] = await Promise.all([
      monthTotals(month),
      financeByCategory(`${month}-01`, today, 'income'),
      financeByCategory(`${month}-01`, today, 'expense'),
    ]);
    return { totals, incomeCategories, expenseCategories };
  }, [month, today]);
  const totals = data?.totals || { income_kop: 0, expense_kop: 0, net_kop: 0 };
  const renderCategories = (items, color) => (items || []).map((c) => (
    <View key={`${c.name}-${color}`} style={{ padding: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: colors.text }}>{c.name}</Text><Text style={{ color }}>{formatKop(c.amount_kop)}</Text>
    </View>
  ));
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 32 }}>
    <Section title={`Итоги за ${month}`}>
      <Text style={{ color: colors.text, padding: 12 }}>Доходы: <Text style={{ color: colors.success }}>{formatKop(totals.income_kop)}</Text></Text>
      <Text style={{ color: colors.text, padding: 12 }}>Расходы: <Text style={{ color: colors.error }}>{formatKop(totals.expense_kop)}</Text></Text>
      <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700', padding: 12 }}>
        {totals.net_kop < 0 ? '−' : '+'}{formatKop(Math.abs(totals.net_kop))}
      </Text>
    </Section>
    <Section title="Доходы по категориям">
      {renderCategories(data?.incomeCategories, colors.success)}
    </Section>
    <Section title="Расходы по категориям">
      {renderCategories(data?.expenseCategories, colors.error)}
    </Section>
  </ScrollView>;
}
export default function ExpenseAnalyticsScreen({ navigation }) { return <JournalGate navigation={navigation}><Content /></JournalGate>; }
