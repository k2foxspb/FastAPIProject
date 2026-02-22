import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { getShadow } from '../utils/shadowStyles';
import { useFocusEffect } from '@react-navigation/native';
import { ordersApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { Ionicons as Icon } from '@expo/vector-icons';

export default function OrdersScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    try {
      setLoading(true);
      const res = await ordersApi.getOrders();
      setOrders(res.data.items || res.data);
    } catch (err) {
      console.log('Failed to load orders', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadOrders();
    }, [loadOrders])
  );

  const getStatusColor = (status) => {
    switch (status) {
      case 'paid': return colors.success || '#4CAF50';
      case 'pending': return colors.warning || '#FFC107';
      case 'canceled':
      case 'failed': return colors.error || '#F44336';
      default: return colors.textSecondary;
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'paid': return 'Оплачен';
      case 'pending': return 'Ожидает оплаты';
      case 'canceled': return 'Отменен';
      case 'failed': return 'Ошибка оплаты';
      default: return status;
    }
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={[styles.orderCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => {/* Можно добавить переход к деталям заказа */}}
    >
      <View style={styles.orderHeader}>
        <Text style={[styles.orderNumber, { color: colors.text }]}>Заказ #{item.id}</Text>
        <Text style={[styles.orderDate, { color: colors.textSecondary }]}>
          {new Date(item.created_at).toLocaleDateString()}
        </Text>
      </View>
      <View style={styles.orderFooter}>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '20' }]}>
          <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
            {getStatusText(item.status)}
          </Text>
        </View>
        <Text style={[styles.orderAmount, { color: colors.primary }]}>{item.total_amount} руб.</Text>
      </View>
      <Text style={[styles.itemsCount, { color: colors.textSecondary }]}>
        Товаров: {item.items?.length || 0}
      </Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={{ color: colors.textSecondary }}>У вас пока нет заказов</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  listContent: { padding: 15 },
  orderCard: {
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
    borderWidth: 1,
    ...getShadow('#000', { width: 0, height: 1 }, 0.1, 2, 2),
  },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  orderNumber: { fontSize: 16, fontWeight: 'bold' },
  orderDate: { fontSize: 14 },
  orderFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontWeight: 'bold' },
  orderAmount: { fontSize: 18, fontWeight: 'bold' },
  itemsCount: { fontSize: 14, marginTop: 5 },
});
