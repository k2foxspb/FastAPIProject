import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Text, TouchableOpacity, View } from 'react-native';
import { EmptyState, JournalGate, useColors } from '../../components/journal/common';
import { journalApi } from '../../api/journal';
import { formatKop } from '../../journal/utils/money';

function Content() {
  const colors = useColors();
  const [items, setItems] = useState([]);
  const [refresh, setRefresh] = useState(0);
  React.useEffect(() => {
    let active = true;
    journalApi.getImportBatches().then((response) => active && setItems(response.data.items || [])).catch(() => active && setItems([]));
    return () => { active = false; };
  }, [refresh]);
  const undoImport = (item) => Alert.alert('Отменить импорт?', `Будут помечены удалёнными операции из «${item.filename}».`, [
    { text: 'Не отменять', style: 'cancel' },
    { text: 'Отменить импорт', style: 'destructive', onPress: async () => {
      try { await journalApi.revertImportBatch(item.uuid); setRefresh((value) => value + 1); }
      catch (error) { Alert.alert('Ошибка', error?.response?.data?.detail || 'Не удалось отменить импорт'); }
    } },
  ]);
  return <FlatList style={{ backgroundColor: colors.background }} data={items} keyExtractor={(item) => item.uuid}
    contentContainerStyle={{ padding: 12 }}
    renderItem={({ item }) => <View style={{ padding: 14, marginBottom: 8, borderRadius: 12, backgroundColor: colors.card }}>
      <Text style={{ color: colors.text, fontWeight: '600' }}>{item.filename}</Text>
      <Text style={{ color: colors.textSecondary, marginTop: 4 }}>{item.status} · операций {item.imported_count} · дублей {item.duplicate_count}</Text>
      {item.status !== 'reverted' && <TouchableOpacity onPress={() => undoImport(item)} style={{ marginTop: 12 }}>
        <Text style={{ color: colors.error, fontWeight: '600' }}>Отменить импорт</Text>
      </TouchableOpacity>}
    </View>}
    ListEmptyComponent={<EmptyState icon="cloud-upload-outline" title="Импортов пока нет" subtitle="Загрузите выписку банка, чтобы добавить операции пачкой" />}
  />;
}
export default function ImportBatchesScreen({ navigation }) { return <JournalGate navigation={navigation}><Content /></JournalGate>; }
