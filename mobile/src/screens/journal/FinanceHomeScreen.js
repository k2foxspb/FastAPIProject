import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { formatKop } from '../../journal/utils/money';
import { accountBalances, listTransactions } from '../../journal/db/repos/finance';
import { JournalGate, Section, useColors } from '../../components/journal/common';
import { useJournalQuery } from '../../context/JournalContext';

const LINKS = [
  ['Accounts', 'Счета'], ['FinanceCategories', 'Категории'], ['Budgets', 'Бюджеты'],
  ['ImportPick', 'Импорт выписки'], ['ImportBatches', 'История импорта'], ['ReviewQueue', 'Разобрать'],
  ['TransferPairs', 'Найденные переводы'],
  ['ImportRules', 'Правила импорта'], ['ExpenseAnalytics', 'Аналитика расходов'],
];

function Content({ navigation }) {
  const colors = useColors();
  const { data: accounts } = useJournalQuery(accountBalances, []);
  const { data: transactions } = useJournalQuery(() => listTransactions({ limit: 20 }), []);
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 32 }}>
      <Section title="Счета">
        {(accounts || []).map((account) => (
          <View key={account.uuid} style={{ padding: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text }}>{account.name}</Text>
            <Text style={{ color: colors.text, fontWeight: '600' }}>{formatKop(account.balance_kop)}</Text>
          </View>
        ))}
      </Section>
      <TouchableOpacity onPress={() => navigation.navigate('TransactionEdit', { direction: 'expense' })}
        style={{ margin: 16, padding: 15, alignItems: 'center', borderRadius: 12, backgroundColor: colors.primary }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>＋ Расход</Text>
      </TouchableOpacity>
      <Section title="Финансы">
        {LINKS.map(([screen, title]) => (
          <TouchableOpacity key={screen} onPress={() => navigation.navigate(screen)}
            style={{ padding: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
            <Text style={{ color: colors.text }}>{title}  ›</Text>
          </TouchableOpacity>
        ))}
      </Section>
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
      </Section>
    </ScrollView>
  );
}

export default function FinanceHomeScreen({ navigation }) {
  return <JournalGate navigation={navigation}><Content navigation={navigation} /></JournalGate>;
}
