import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { JournalGate, PrimaryButton, Section, useColors } from '../../components/journal/common';
import { journalApi } from '../../api/journal';
import { formatKop } from '../../journal/utils/money';

function Content({ navigation, route }) {
  const colors = useColors();
  const { preview, accountUuid, mapping } = route.params || {};
  const [loading, setLoading] = useState(false);
  const commit = async () => {
    setLoading(true);
    try {
      const response = await journalApi.importCommit({
        preview_token: preview.preview_token, account_uuid: accountUuid, mapping,
      });
      const result = response.data;
      const pairs = result.transfer_suggestions?.length || 0;
      Alert.alert('Импорт завершён', `Добавлено: ${result.imported_count}; дублей: ${result.duplicate_count}; разобрать: ${result.review_count}${pairs ? `; возможных переводов: ${pairs}` : ''}`);
      navigation.navigate('ImportBatches');
    } catch (error) {
      Alert.alert('Импорт не выполнен', error?.response?.data?.detail || 'Проверьте сопоставление колонок.');
    } finally { setLoading(false); }
  };
  const rows = (preview?.rows || []).slice(0, 20);
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 32 }}>
    <Section title={`Предпросмотр · первые ${rows.length} из ${preview?.row_count || 0}`}>
      {rows.map((row, index) => <View key={index} style={{ padding: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
        {(preview?.headers || []).map((header, column) => <Text key={`${index}:${column}`} numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12 }}>
          {header}: {String(row[header] ?? '')}
        </Text>)}
      </View>)}
    </Section>
    <Text style={{ color: colors.textSecondary, marginHorizontal: 16, marginTop: 12 }}>После импорта его можно отменить в истории партий.</Text>
    <PrimaryButton title="Импортировать выписку" onPress={commit} loading={loading} />
  </ScrollView>;
}
export default function ImportPreviewScreen({ navigation, route }) { return <JournalGate navigation={navigation}><Content navigation={navigation} route={route} /></JournalGate>; }
