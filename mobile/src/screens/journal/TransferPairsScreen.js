import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { JournalGate, useColors } from '../../components/journal/common';
import { useJournal, useJournalQuery } from '../../context/JournalContext';
import { listTransactions } from '../../journal/db/repos/finance';
import { journalApi } from '../../api/journal';
import { formatKop } from '../../journal/utils/money';

function Content() {
  const colors = useColors();
  const { syncNow } = useJournal();
  const { data: transactions } = useJournalQuery(() => listTransactions({ limit: 1000 }), []);
  const [pairs, setPairs] = useState([]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    journalApi.getTransferPairs().then((response) => active && setPairs(response.data.items || [])).catch(() => active && setPairs([]));
    return () => { active = false; };
  }, [version]);
  const lookup = new Map((transactions || []).map((transaction) => [transaction.uuid, transaction]));
  const merge = (pair) => Alert.alert('Объединить перевод?', 'Расход и зачисление будут учтены как перевод между счетами.', [
    { text: 'Отмена', style: 'cancel' },
    { text: 'Объединить', onPress: async () => {
      try {
        await journalApi.mergeTransferPair(pair.first_uuid, pair.second_uuid);
        await syncNow();
        setVersion((current) => current + 1);
      } catch (error) { Alert.alert('Ошибка', error?.response?.data?.detail || 'Не удалось объединить операции'); }
    } },
  ]);
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 12 }}>
    {pairs.map((pair, index) => {
      const first = lookup.get(pair.first_uuid);
      const second = lookup.get(pair.second_uuid);
      if (!first || !second) return null;
      return <View key={`${pair.first_uuid}:${pair.second_uuid}`} style={{ padding: 14, marginBottom: 10, borderRadius: 12, backgroundColor: 'transparent' }}>
        {[first, second].map((item) => <Text key={item.uuid} style={{ color: colors.text, marginBottom: 4 }}>
          {item.transaction_date} · {item.description} · {formatKop(item.amount_kop)}
        </Text>)}
        <TouchableOpacity onPress={() => merge(pair)} style={{ marginTop: 10 }}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Объединить перевод</Text>
        </TouchableOpacity>
      </View>;
    })}
    {!pairs.length && <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 24 }}>Возможных переводов не найдено</Text>}
  </ScrollView>;
}
export default function TransferPairsScreen({ navigation }) { return <JournalGate navigation={navigation}><Content /></JournalGate>; }
