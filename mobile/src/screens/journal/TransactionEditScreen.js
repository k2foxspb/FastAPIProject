import React, { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import MoneyInput from '../../components/journal/MoneyInput';
import { Field, JournalGate, PrimaryButton, useColors } from '../../components/journal/common';
import { useJournal, useJournalQuery } from '../../context/JournalContext';
import {
  listAccounts, listFinanceCategories, getTransaction, saveTransaction, deleteTransaction, saveAccount, saveFinanceCategory,
} from '../../journal/db/repos/finance';

function InlineCreate({ colors, visible, onToggle, toggleTitle, value, onChangeText, placeholder, onSubmit }) {
  return (
    <View style={{ paddingHorizontal: 12, marginBottom: 8 }}>
      <TouchableOpacity onPress={onToggle} style={{ paddingVertical: 6 }}>
        <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>{toggleTitle}</Text>
      </TouchableOpacity>
      {visible && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder}
            placeholderTextColor={colors.textSecondary}
            style={{ flex: 1, color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 10 }} />
          <TouchableOpacity onPress={onSubmit} style={{ backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 }}>
            <Text style={{ color: '#fff', fontWeight: '600' }}>Добавить</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function Content({ navigation, route }) {
  const colors = useColors();
  const { today } = useJournal();
  const { data: accounts } = useJournalQuery(listAccounts, []);
  const [direction, setDirection] = useState(route.params?.direction || 'expense');
  const { data: categories } = useJournalQuery(() => listFinanceCategories(direction), [direction]);
  const [accountUuid, setAccountUuid] = useState(route.params?.account_uuid || '');
  const [categoryUuid, setCategoryUuid] = useState('');
  const [transactionDate, setTransactionDate] = useState(route.params?.date || today);
  const [description, setDescription] = useState('');
  const [amountKop, setAmountKop] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);

  const createAccount = async () => {
    const name = newAccountName.trim();
    if (!name) return;
    try {
      const uuid = await saveAccount({ name, kind: 'cash', currency: 'RUB', opening_balance_kop: 0 });
      setAccountUuid(uuid);
      setNewAccountName('');
      setShowAccountForm(false);
    } catch (error) { Alert.alert('Ошибка', error?.message || 'Не удалось создать счёт'); }
  };

  const createCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      const uuid = await saveFinanceCategory({ name, kind: direction, parent_uuid: null, icon: null, color: null, sort_order: 1000 });
      setCategoryUuid(uuid);
      setNewCategoryName('');
      setShowCategoryForm(false);
    } catch (error) { Alert.alert('Ошибка', error?.message || 'Не удалось создать категорию'); }
  };

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
      await saveTransaction({ account_uuid: accountUuid, category_uuid: categoryUuid || null,
        transaction_date: transactionDate, direction, amount_kop: amountKop, description: description.trim(), source: 'manual' }, route.params?.uuid || null);
      navigation.goBack();
    } catch (error) { Alert.alert('Ошибка', error?.message || 'Не удалось сохранить операцию'); }
    finally { setSaving(false); }
  };

  const remove = () => Alert.alert('Удалить операцию?', 'Операция будет удалена со счёта.', [
    { text: 'Отмена', style: 'cancel' },
    {
      text: 'Удалить',
      style: 'destructive',
      onPress: async () => {
        try {
          await deleteTransaction(route.params.uuid);
          navigation.goBack();
        } catch (error) { Alert.alert('Ошибка', error?.message || 'Не удалось удалить операцию'); }
      },
    },
  ]);

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 32 }}>
      <Field label="Тип операции"><Picker selectedValue={direction} onValueChange={setDirection}>
        <Picker.Item label="Расход" value="expense" /><Picker.Item label="Доход" value="income" />
      </Picker></Field>
      <Field label="Счёт"><Picker selectedValue={accountUuid} onValueChange={setAccountUuid}>
        {(accounts || []).map((item) => <Picker.Item key={item.uuid} label={item.name} value={item.uuid} />)}
      </Picker></Field>
      <InlineCreate
        colors={colors}
        visible={showAccountForm}
        onToggle={() => setShowAccountForm((v) => !v)}
        toggleTitle="+ Создать счёт"
        value={newAccountName}
        onChangeText={setNewAccountName}
        placeholder="Название счёта"
        onSubmit={createAccount}
      />
      <Field label="Категория"><Picker selectedValue={categoryUuid} onValueChange={setCategoryUuid}>
        <Picker.Item label="Без категории" value="" />
        {(categories || []).map((item) => <Picker.Item key={item.uuid} label={item.name} value={item.uuid} />)}
      </Picker></Field>
      <InlineCreate
          colors={colors}
          visible={showCategoryForm}
          onToggle={() => setShowCategoryForm((v) => !v)}
          toggleTitle="+ Создать категорию"
          value={newCategoryName}
          onChangeText={setNewCategoryName}
          placeholder="Название категории"
          onSubmit={createCategory}
        />
      <Field label="Дата"><TextInput value={transactionDate} onChangeText={setTransactionDate} placeholder="ГГГГ-ММ-ДД"
        placeholderTextColor={colors.textSecondary} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12 }} /></Field>
      <Field label="Сумма, ₽"><MoneyInput value={amountKop} onChangeKop={setAmountKop} /></Field>
      <Field label="Описание"><TextInput value={description} onChangeText={setDescription} placeholder="Например, продукты"
        placeholderTextColor={colors.textSecondary} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12 }} /></Field>
      <PrimaryButton title="Сохранить операцию" onPress={save} loading={saving} />
      {!!route.params?.uuid && (
        <TouchableOpacity onPress={remove} style={{ margin: 16, padding: 15, alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.error }}>
          <Text style={{ color: colors.error, fontWeight: '700' }}>Удалить операцию</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

export default function TransactionEditScreen(props) {
  return <JournalGate navigation={props.navigation}><Content {...props} /></JournalGate>;
}
