import React, { useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { EmptyState, JournalGate, PrimaryButton, Section, useColors } from '../../components/journal/common';
import { useJournalQuery } from '../../context/JournalContext';
import { listFinanceCategories, saveFinanceCategory } from '../../journal/db/repos/finance';

function Content() {
  const colors = useColors();
  const { data: categories } = useJournalQuery(() => listFinanceCategories(), []);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('expense');
  const add = async () => {
    if (!name.trim()) return;
    await saveFinanceCategory({ name: name.trim(), kind, parent_uuid: null, icon: null, color: null, sort_order: 100 });
    setName('');
  };
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 32 }}>
    <Section title="Категории">{(categories || []).map((category) => <View key={category.uuid} style={{ padding: 12 }}>
      <Text style={{ color: colors.text }}>{category.kind === 'expense' ? '−' : '+'} {category.name}</Text>
    </View>)}
      {categories && categories.length === 0 && (
        <EmptyState icon="pricetags-outline" title="Категорий нет" subtitle="Добавьте первую категорию ниже" />
      )}
    </Section>
    <Section title="Новая категория"><View style={{ paddingHorizontal: 12 }}>
      <TextInput value={name} onChangeText={setName} placeholder="Название" placeholderTextColor={colors.textSecondary}
        style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12 }} />
      <Picker selectedValue={kind} onValueChange={setKind}><Picker.Item label="Расход" value="expense" /><Picker.Item label="Доход" value="income" /></Picker>
      <PrimaryButton title="Добавить" onPress={add} disabled={!name.trim()} />
    </View></Section>
  </ScrollView>;
}
export default function FinanceCategoriesScreen({ navigation }) { return <JournalGate navigation={navigation}><Content /></JournalGate>; }
