import React, { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { JournalGate, PrimaryButton, Section, useColors } from '../../components/journal/common';
import { useJournalQuery } from '../../context/JournalContext';
import { listFinanceCategories, listImportRules, saveImportRule } from '../../journal/db/repos/finance';

function Content() {
  const colors = useColors();
  const { data: rules } = useJournalQuery(listImportRules, []);
  const { data: categories } = useJournalQuery(() => listFinanceCategories('expense'), []);
  const [matchText, setMatchText] = useState('');
  const [categoryUuid, setCategoryUuid] = useState('');
  const add = async () => {
    if (!matchText.trim() || !categoryUuid) { Alert.alert('Заполните правило', 'Укажите фразу и категорию.'); return; }
    await saveImportRule({ match_text: matchText.trim(), match_field: 'description', category_uuid: categoryUuid, priority: 100, enabled: true });
    setMatchText('');
  };
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 32 }}>
    <Section title="Правила">{(rules || []).map((rule) => <View key={rule.uuid} style={{ padding: 12 }}>
      <Text style={{ color: colors.text }}>{rule.match_text} → {(categories || []).find((c) => c.uuid === rule.category_uuid)?.name || 'категория удалена'}</Text>
    </View>)}</Section>
    <Section title="Новое правило"><View style={{ paddingHorizontal: 12 }}>
      <TextInput value={matchText} onChangeText={setMatchText} placeholder="Текст в назначении платежа" placeholderTextColor={colors.textSecondary}
        style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12 }} />
      <Picker selectedValue={categoryUuid} onValueChange={setCategoryUuid}>
        <Picker.Item label="Категория расходов" value="" />
        {(categories || []).map((category) => <Picker.Item key={category.uuid} label={category.name} value={category.uuid} />)}
      </Picker>
      <PrimaryButton title="Сохранить правило" onPress={add} disabled={!matchText.trim() || !categoryUuid} />
    </View></Section>
  </ScrollView>;
}
export default function ImportRulesScreen({ navigation }) { return <JournalGate navigation={navigation}><Content /></JournalGate>; }
