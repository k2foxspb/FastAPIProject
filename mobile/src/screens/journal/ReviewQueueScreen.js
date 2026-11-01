import React from 'react';
import { Alert, FlatList, Text, TouchableOpacity, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { EmptyState, JournalGate, useColors } from '../../components/journal/common';
import { useJournalQuery } from '../../context/JournalContext';
import { listFinanceCategories, reviewQueue, resolveReview } from '../../journal/db/repos/finance';
import { formatKop } from '../../journal/utils/money';

function Content() {
  const colors = useColors();
  const { data: items } = useJournalQuery(reviewQueue, []);
  const { data: categories } = useJournalQuery(() => listFinanceCategories('expense'), []);
  return <FlatList style={{ backgroundColor: colors.background }} data={items || []} keyExtractor={(item) => item.uuid}
    contentContainerStyle={{ padding: 12 }}
    renderItem={({ item }) => <View style={{ padding: 12, marginBottom: 8, borderRadius: 12, backgroundColor: colors.card }}>
      <Text style={{ color: colors.text, fontWeight: '600' }}>{item.description}</Text>
      <Text style={{ color: colors.textSecondary }}>{item.transaction_date} · {formatKop(item.amount_kop)} · {item.account_name || ''}</Text>
      <Picker selectedValue="" onValueChange={(uuid) => {
        if (uuid) resolveReview(item.uuid, uuid).catch((error) => Alert.alert('Ошибка', error?.message || 'Не удалось сохранить'));
      }}>
        <Picker.Item label="Выберите категорию для разбора" value="" />
        {(categories || []).map((category) => <Picker.Item key={category.uuid} label={category.name} value={category.uuid} />)}
      </Picker>
      <TouchableOpacity onPress={() => resolveReview(item.uuid, null)}><Text style={{ color: colors.primary, padding: 6 }}>Оставить без категории</Text></TouchableOpacity>
    </View>}
    ListEmptyComponent={items ? <EmptyState icon="checkmark-done-outline" title="Очередь пуста" subtitle="Все операции с категориями, ничего разбирать не нужно" /> : null}
  />;
}
export default function ReviewQueueScreen({ navigation }) { return <JournalGate navigation={navigation}><Content /></JournalGate>; }
