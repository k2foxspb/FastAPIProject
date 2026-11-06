import React, { useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { formatKop } from '../../journal/utils/money';
import { listTransactions, monthTotals } from '../../journal/db/repos/finance';
import { EmptyState, JournalGate, Section, useColors } from '../../components/journal/common';
import { useJournal, useJournalQuery } from '../../context/JournalContext';

const PAGE = 20;

const LINKS = [
  ['FinanceCategories', 'Категории'],
  ['ExpenseAnalytics', 'Аналитика расходов'],
];

function Content({ navigation }) {
  const colors = useColors();
  const { today } = useJournal();
  const month = today.slice(0, 7);
  const { data: totals } = useJournalQuery(() => monthTotals(month), [month]);
  const [limit, setLimit] = useState(PAGE);
  const { data: transactions } = useJournalQuery(() => listTransactions({ limit }), [limit]);
  const addFinance = () => Alert.alert('Добавить', 'Что создать?', [
    { text: 'Расход', onPress: () => navigation.navigate('TransactionEdit', { direction: 'expense' }) },
    { text: 'Доход', onPress: () => navigation.navigate('TransactionEdit', { direction: 'income' }) },
    { text: 'Отмена', style: 'cancel' },
  ]);
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 32 }}>
      <TouchableOpacity onPress={addFinance}
        style={{ margin: 16, padding: 15, alignItems: 'center', borderRadius: 12, backgroundColor: colors.primary }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>＋ Добавить</Text>
      </TouchableOpacity>
      <Section title="Финансы">
        {LINKS.map(([screen, title]) => (
          <TouchableOpacity key={screen} onPress={() => navigation.navigate(screen)}
            style={{ padding: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
            <Text style={{ color: colors.text }}>{title}  ›</Text>
          </TouchableOpacity>
        ))}
      </Section>
      {totals && (
        <Section title={`Итоги · ${month}`}>
          <View style={{ padding: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
              <Text style={{ color: colors.text }}>Доходы</Text>
              <Text style={{ color: colors.success }}>+{formatKop(totals.income_kop)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
              <Text style={{ color: colors.text }}>Расходы</Text>
              <Text style={{ color: colors.error }}>−{formatKop(totals.expense_kop)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 0.5, borderTopColor: colors.border, marginTop: 4 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Разница</Text>
              <Text style={{ color: totals.net_kop < 0 ? colors.error : colors.success, fontWeight: '700' }}>
                {formatKop(totals.net_kop)}
              </Text>
            </View>
          </View>
        </Section>
      )}
      <Section title="Последние операции">
        {(transactions || []).map((item) => (
          <TouchableOpacity key={item.uuid} onPress={() => navigation.navigate('TransactionEdit', { uuid: item.uuid })}
            style={{ padding: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={{ color: colors.text, flex: 1 }}>{item.description}</Text>
            <Text style={{ color: item.direction === 'expense' ? colors.error : colors.success, marginLeft: 10 }}>
              {item.direction === 'expense' ? '−' : '+'}{formatKop(item.amount_kop)}
            </Text>
          </TouchableOpacity>
        ))}
        {transactions && transactions.length === 0 && (
          <EmptyState icon="receipt-outline" title="Операций пока нет" subtitle="Добавьте расход или доход кнопкой «＋ Расход» выше" />
        )}
        {transactions && transactions.length >= limit && (
          <TouchableOpacity onPress={() => setLimit(limit + PAGE)} style={{ padding: 12, alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>Показать ещё</Text>
          </TouchableOpacity>
        )}
      </Section>
    </ScrollView>
  );
}

export default function FinanceHomeScreen({ navigation }) {
  return <JournalGate navigation={navigation}><Content navigation={navigation} /></JournalGate>;
}
