import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { cartApi, ordersApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { getFullUrl } from '../utils/urlHelper';
import { Ionicons as Icon } from '@expo/vector-icons';

export default function CartScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const loadCart = useCallback(async () => {
    try {
      setLoading(true);
      const res = await cartApi.getCart();
      setCart(res.data);
    } catch (err) {
      console.log('Failed to load cart', err);
      Alert.alert('Ошибка', 'Не удалось загрузить корзину');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCart();
    }, [loadCart])
  );

  const handleUpdateQuantity = async (productId, newQuantity) => {
    if (newQuantity < 1) {
      handleRemoveItem(productId);
      return;
    }
    try {
      setUpdating(true);
      await cartApi.updateItem(productId, newQuantity);
      const res = await cartApi.getCart();
      setCart(res.data);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось обновить количество');
    } finally {
      setUpdating(false);
    }
  };

  const handleRemoveItem = (productId) => {
    Alert.alert(
      'Удаление',
      'Вы уверены, что хотите удалить этот товар из корзины?',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            try {
              setUpdating(true);
              await cartApi.removeItem(productId);
              const res = await cartApi.getCart();
              setCart(res.data);
            } catch (err) {
              Alert.alert('Ошибка', 'Не удалось удалить товар');
            } finally {
              setUpdating(false);
            }
          },
        },
      ]
    );
  };

  const handleCheckout = async () => {
    try {
      setUpdating(true);
      const res = await ordersApi.checkout();
      const order = res.data.order || res.data;
      const confirmationUrl = res.data.confirmation_url;

      Alert.alert(
        'Заказ оформлен',
        `Заказ #${order.id} успешно создан.`,
        [
          {
            text: 'ОК',
            onPress: () => {
              // Здесь можно перенаправить на экран оплаты или список заказов
              navigation.navigate('Orders'); 
            }
          }
        ]
      );
    } catch (err) {
      console.log('Checkout error', err.response?.data);
      const detail = err.response?.data?.detail || 'Не удалось оформить заказ';
      Alert.alert('Ошибка', detail);
    } finally {
      setUpdating(false);
    }
  };

  const renderItem = ({ item }) => (
    <View style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Image
        source={{ uri: getFullUrl(item.product.thumbnail_url) || 'https://via.placeholder.com/150' }}
        style={styles.itemImage}
      />
      <View style={styles.itemInfo}>
        <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={2}>
          {item.product.name}
        </Text>
        <Text style={[styles.itemPrice, { color: colors.primary }]}>
          {item.product.price} руб.
        </Text>
        <View style={styles.quantityContainer}>
          <TouchableOpacity
            style={[styles.quantityButton, { backgroundColor: colors.border }]}
            onPress={() => handleUpdateQuantity(item.product_id, item.quantity - 1)}
            disabled={updating}
          >
            <Icon name="remove" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.quantityText, { color: colors.text }]}>{item.quantity}</Text>
          <TouchableOpacity
            style={[styles.quantityButton, { backgroundColor: colors.border }]}
            onPress={() => handleUpdateQuantity(item.product_id, item.quantity + 1)}
            disabled={updating}
          >
            <Icon name="add" size={20} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleRemoveItem(item.product_id)}
            disabled={updating}
          >
            <Icon name="trash-outline" size={20} color={colors.error} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Icon name="cart-outline" size={80} color={colors.textSecondary} />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Ваша корзина пуста</Text>
        <TouchableOpacity
          style={[styles.shopButton, { backgroundColor: colors.primary }]}
          onPress={() => navigation.navigate('Feed')}
        >
          <Text style={styles.shopButtonText}>Перейти к покупкам</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={cart?.items || []}
        keyExtractor={(item) => item?.product_id?.toString() || Math.random().toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
      />
      <View style={[styles.footer, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <View style={styles.totalRow}>
          <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>Итого:</Text>
          <Text style={[styles.totalAmount, { color: colors.text }]}>{cart.total_price} руб.</Text>
        </View>
        <TouchableOpacity
          style={[styles.checkoutButton, { backgroundColor: colors.primary }]}
          onPress={handleCheckout}
          disabled={updating}
        >
          {updating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.checkoutButtonText}>Оформить заказ</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  listContent: { padding: 15 },
  itemCard: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 10,
    marginBottom: 15,
    borderWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  itemImage: { width: 80, height: 80, borderRadius: 8 },
  itemInfo: { flex: 1, marginLeft: 15, justifyContent: 'space-between' },
  itemName: { fontSize: 16, fontWeight: '500' },
  itemPrice: { fontSize: 16, fontWeight: 'bold', marginTop: 4 },
  quantityContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  quantityButton: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  quantityText: { marginHorizontal: 15, fontSize: 16, fontWeight: 'bold' },
  deleteButton: { marginLeft: 'auto', padding: 5 },
  emptyText: { fontSize: 18, marginTop: 20, textAlign: 'center' },
  shopButton: { marginTop: 20, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8 },
  shopButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  footer: { padding: 20, borderTopWidth: 1, elevation: 10 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  totalLabel: { fontSize: 16 },
  totalAmount: { fontSize: 20, fontWeight: 'bold' },
  checkoutButton: { paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  checkoutButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});
