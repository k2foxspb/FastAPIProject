import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import api from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { Ionicons as Icon } from '@expo/vector-icons';

export default function AdminOrdersScreen() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const fetchOrders = async () => {
    try {
      const res = await api.get('/admin/orders');
      setOrders(res.data);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить заказы');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const deleteOrder = (id) => {
    Alert.alert(
      'Удаление',
      'Вы уверены, что хотите удалить этот заказ?',
      [
        { text: 'Отмена', style: 'cancel' },
        { 
          text: 'Удалить', 
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/admin/orders/${id}`);
              fetchOrders();
            } catch (err) {
              Alert.alert('Ошибка', 'Не удалось удалить заказ');
            }
          }
        }
      ]
    );
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'paid': return colors.success || '#4CAF50';
      case 'pending': return colors.warning || '#FF9800';
      case 'failed': return colors.error;
      default: return colors.textSecondary;
    }
  };

  const renderOrder = ({ item }) => (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.orderNumber, { color: colors.text }]}>Заказ #{item.id}</Text>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '20' }]}>
          <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>{item.status.toUpperCase()}</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.cardDetail, { color: colors.textSecondary }]}>Пользователь ID: {item.user_id}</Text>
        <Text style={[styles.cardDetail, { color: colors.textSecondary }]}>Дата: {new Date(item.created_at).toLocaleString()}</Text>
        <Text style={[styles.cardTotal, { color: colors.primary }]}>Сумма: {item.total_amount} ₽</Text>
        <Text style={[styles.cardDetail, { color: colors.textSecondary }]}>Позиций: {item.items?.length || 0}</Text>
      </View>
      <TouchableOpacity 
        style={[styles.deleteButton, { backgroundColor: colors.error }]}
        onPress={() => deleteOrder(item.id)}
      >
        <Icon name="trash-outline" size={20} color="#fff" />
      </TouchableOpacity>
    </View>
  );

  if (loading && orders.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={orders}
        keyExtractor={item => item.id.toString()}
        renderItem={renderOrder}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={fetchOrders}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Заказов не найдено</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 15 },
  card: {
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
    borderWidth: 1,
    position: 'relative',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  orderNumber: { fontSize: 18, fontWeight: 'bold' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 12, fontWeight: 'bold' },
  cardBody: { marginBottom: 10 },
  cardDetail: { fontSize: 14, marginTop: 2 },
  cardTotal: { fontSize: 16, fontWeight: 'bold', marginTop: 5 },
  deleteButton: { 
    position: 'absolute', 
    bottom: 15, 
    right: 15, 
    padding: 10, 
    borderRadius: 8 
  },
  emptyText: { textAlign: 'center', marginTop: 50, fontSize: 16 },
});
