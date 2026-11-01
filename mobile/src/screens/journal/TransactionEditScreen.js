import React, { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import MoneyInput from '../../components/journal/MoneyInput';
import { Field, JournalGate, PrimaryButton, useColors } from '../../components/journal/common';
import { useJournal, useJournalQuery } from '../../context/JournalContext';
import { listAccounts, listFinanceCategories, getTransaction, saveTransaction } from '../../journal/db/repos/finance';

function Content({ navigation, route }) {
  const colors = useColors();
  const { today } = useJournal();
  const { data: accounts } = useJournalQuery(listAccounts, []);
  const { data: categories } = useJournalQuery(() => listFinanceCategories('expense'), []);
  const [direction, setDirection] = useState(route.params?.direction || 'expense');
  const [accountUuid, setAccountUuid] = useState(route.params?.account_uuid || '');
  const [categoryUuid, setCategoryUuid] = useState('');
  const [transactionDate, setTransactionDate] = useState(route.params?.date || today);
  const [description, setDescription] = useState('');
  const [amountKop, setAmountKop] = useState(null);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (!route.params?.uuid) return;
    getTransaction(route.params.uuid).then((item) => {
      if (!item) return;
      setDirection(item.direction);
      setAccountUuid(item.account_uuid || '');
      setCategoryUuid(item.category_uuid || '');
      setTransactionDate(item.transaction_date);
      setDescription(item.description || '');
      setAmountKop(item.amount_kop);
    }).catch(() => undefined);
  }, [route.params?.uuid]);

  const save = async () => {
    if (!accountUuid || !description.trim() || !amountKop) {
      Alert.alert('Проверьте операцию', 'Выберите счёт и укажите описание и сумму.');
      return;
    }
    setSaving(true);
    try {
      await saveTransaction({ account_uuid: accountUuid, category_uuid: direction === 'expense' ? categoryUuid : null,
        transaction_date: transactionDate, direction, amount_kop: amountKop, description: description.trim(), source: 'manual' }, route.params?.uuid || null);
      navigation.goBack();
    } catch (error) { Alert.alert('Ошибка', error?.message || 'Не удалось сохранить операцию'); }
    finally { setSaving(false); }
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 32 }}>
      <Field label="Тип операции"><Picker selectedValue={direction} onValueChange={setDirection}>
        <Picker.Item label="Расход" value="expense" /><Picker.Item label="Доход" value="income" />
      </Picker></Field>
      <Field label="Счёт"><Picker selectedValue={accountUuid} onValueChange={setAccountUuid}>
        {(accounts || []).map((item) => <Picker.Item key={item.uuid} label={item.name} value={item.uuid} />)}
      </Picker></Field>
      {direction === 'expense' && <Field label="Категория"><Picker selectedValue={categoryUuid} onValueChange={setCategoryUuid}>
        <Picker.Item label="Без категории" value="" />
        {(categories || []).map((item) => <Picker.Item key={item.uuid} label={item.name} value={item.uuid} />)}
      </Picker></Field>}
      <Field label="Дата"><TextInput value={transactionDate} onChangeText={setTransactionDate} placeholder="ГГГГ-ММ-ДД"
        placeholderTextColor={colors.textSecondary} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12 }} /></Field>
      <Field label="Сумма, ₽"><MoneyInput value={amountKop} onChangeKop={setAmountKop} /></Field>
      <Field label="Описание"><TextInput value={description} onChangeText={setDescription} placeholder="Например, продукты"
        placeholderTextColor={colors.textSecondary} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12 }} /></Field>
      <PrimaryButton title="Сохранить операцию" onPress={save} loading={saving} />
    </ScrollView>
  );
}

export default function TransactionEditScreen(props) {
  return <JournalGate navigation={props.navigation}><Content {...props} /></JournalGate>;
}
