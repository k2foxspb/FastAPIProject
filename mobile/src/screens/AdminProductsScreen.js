import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator,
  Modal, TextInput, TouchableWithoutFeedback, KeyboardAvoidingView, Switch,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { timesheetApi } from '../api';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

// CRUD справочника продукции/приборов, которые сотрудники указывают при
// заполнении количества сданной продукции за день (см. /timesheet/products).
export default function AdminProductsScreen() {
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formVisible, setFormVisible] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [unit, setUnit] = useState('шт');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await timesheetApi.getProducts(true);
      setProducts(res.data);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить список продукции');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchProducts(); }, [fetchProducts]));

  const openCreateForm = () => {
    setEditingProduct(null);
    setName('');
    setCode('');
    setUnit('шт');
    setIsActive(true);
    setFormVisible(true);
  };

  const openEditForm = (product) => {
    setEditingProduct(product);
    setName(product.name);
    setCode(product.code || '');
    setUnit(product.unit);
    setIsActive(product.is_active);
    setFormVisible(true);
  };

  const saveProduct = async () => {
    if (!name.trim()) {
      Alert.alert('Ошибка', 'Введите наименование продукции');
      return;
    }
    if (!unit.trim()) {
      Alert.alert('Ошибка', 'Укажите единицу измерения');
      return;
    }
    setSaving(true);
    try {
      const payload = { name: name.trim(), code: code.trim() || null, unit: unit.trim(), is_active: isActive };
      if (editingProduct) {
        await timesheetApi.updateProduct(editingProduct.id, payload);
      } else {
        await timesheetApi.createProduct(payload);
      }
      setFormVisible(false);
      await fetchProducts();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось сохранить продукцию');
    } finally {
      setSaving(false);
    }
  };

  const deactivateProduct = (product) => {
    Alert.alert(
      'Деактивация продукции',
      `Деактивировать "${product.name}"? История сданных позиций сохранится.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Деактивировать',
          style: 'destructive',
          onPress: async () => {
            try {
              await timesheetApi.deleteProduct(product.id);
              await fetchProducts();
            } catch (err) {
              Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось деактивировать продукцию');
            }
          },
        },
      ]
    );
  };

  const renderProduct = ({ item }) => (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: item.is_active ? 1 : 0.5 }]}>
      <View style={[styles.iconWrap, { backgroundColor: colors.background }]}>
        <Icon name="cube-outline" size={20} color={colors.primary} />
      </View>
      <View style={styles.cardInfo}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{item.name}</Text>
        <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
          {item.code ? `Код: ${item.code} · ` : ''}Ед. изм.: {item.unit}{!item.is_active ? ' · Неактивна' : ''}
        </Text>
      </View>
      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.iconButton} onPress={() => openEditForm(item)}>
          <Icon name="create-outline" size={20} color={colors.primary} />
        </TouchableOpacity>
        {item.is_active && (
          <TouchableOpacity style={styles.iconButton} onPress={() => deactivateProduct(item)}>
            <Icon name="trash-outline" size={20} color={colors.error} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  if (loading && products.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={products}
        keyExtractor={item => item.id.toString()}
        renderItem={renderProduct}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={fetchProducts}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Продукция пока не добавлена</Text>
        }
      />

      <TouchableOpacity style={[styles.fab, { backgroundColor: colors.primary }]} onPress={openCreateForm}>
        <Icon name="add" size={28} color="#fff" />
      </TouchableOpacity>

      <Modal visible={formVisible} transparent animationType="slide" onRequestClose={() => setFormVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setFormVisible(false)}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior="padding" style={{ width: '100%', alignItems: 'center' }}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                  <View style={styles.modalHeader}>
                    <Text style={[styles.modalTitle, { color: colors.text }]}>
                      {editingProduct ? 'Редактировать продукцию' : 'Новая продукция'}
                    </Text>
                    <TouchableOpacity onPress={() => setFormVisible(false)}>
                      <Icon name="close" size={24} color={colors.text} />
                    </TouchableOpacity>
                  </View>

                  <Text style={[styles.label, { color: colors.text }]}>Наименование *</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                    value={name}
                    onChangeText={setName}
                    placeholder="Например, Датчик давления"
                    placeholderTextColor={colors.textSecondary}
                    autoFocus
                  />

                  <Text style={[styles.label, { color: colors.text }]}>Код/артикул</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                    value={code}
                    onChangeText={setCode}
                    placeholder="Необязательно"
                    placeholderTextColor={colors.textSecondary}
                    autoCapitalize="none"
                  />

                  <Text style={[styles.label, { color: colors.text }]}>Единица измерения *</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                    value={unit}
                    onChangeText={setUnit}
                    placeholder="шт"
                    placeholderTextColor={colors.textSecondary}
                  />

                  <View style={styles.switchRow}>
                    <Text style={[styles.label, { color: colors.text, marginTop: 0 }]}>Активна</Text>
                    <Switch
                      value={isActive}
                      onValueChange={setIsActive}
                      trackColor={{ false: colors.border, true: colors.primary + '80' }}
                      thumbColor={isActive ? colors.primary : '#f4f3f4'}
                    />
                  </View>

                  <TouchableOpacity
                    style={[styles.saveButton, { backgroundColor: colors.primary }]}
                    onPress={saveProduct}
                    disabled={saving}
                  >
                    {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Сохранить</Text>}
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 15, paddingBottom: 90 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: 'bold' },
  cardSubtitle: { fontSize: 13, marginTop: 4 },
  cardActions: { flexDirection: 'row', marginLeft: 8 },
  iconButton: { padding: 6, marginLeft: 4 },
  emptyText: { textAlign: 'center', marginTop: 50, fontSize: 16 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
  },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { width: '100%', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  modalTitle: { fontSize: 18, fontWeight: 'bold' },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 15 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 15 },
  saveButton: { marginTop: 20, padding: 14, borderRadius: 10, alignItems: 'center' },
  saveButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
