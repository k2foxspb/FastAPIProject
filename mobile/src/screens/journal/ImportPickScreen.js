import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { JournalGate, PrimaryButton, useColors } from '../../components/journal/common';
import { journalApi } from '../../api/journal';

function Content({ navigation }) {
  const colors = useColors();
  const [loading, setLoading] = useState(false);
  const choose = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/tab-separated-values', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const file = result.assets[0];
    const form = new FormData();
    form.append('file', { uri: file.uri, name: file.name || 'statement.csv', type: file.mimeType || 'text/csv' });
    setLoading(true);
    try {
      const response = await journalApi.importPreview(form);
      navigation.navigate('ImportMapping', { preview: response.data });
    } catch (error) {
      Alert.alert('Не удалось прочитать выписку', error?.response?.data?.detail || 'Проверьте формат и размер файла.');
    } finally { setLoading(false); }
  };
  return <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.background }}>
    <Text style={{ color: colors.text, textAlign: 'center', fontSize: 17, marginBottom: 18 }}>
      Выберите выписку CSV, TSV или XLSX. Перед импортом вы сможете проверить сопоставление и строки.
    </Text>
    <PrimaryButton title="Выбрать файл" onPress={choose} loading={loading} />
  </View>;
}
export default function ImportPickScreen({ navigation }) { return <JournalGate navigation={navigation}><Content navigation={navigation} /></JournalGate>; }
