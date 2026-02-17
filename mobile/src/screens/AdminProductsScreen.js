import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, Image } from 'react-native';
import api from '../api';
import { API_BASE_URL } from '../constants';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function AdminProductsScreen({ navigation }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const fetchProducts = async () => {
    try {
      const res = await api.get('/admin/products');
      setProducts(res.data);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить товары');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const deleteProduct = (id) => {
    Alert.alert(
      'Удаление',
      'Вы уверены, что хотите удалить этот товар?',
      [
        { text: 'Отмена', style: 'cancel' },
        { 
          text: 'Удалить', 
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/admin/products/${id}`);
              fetchProducts();
            } catch (err) {
              Alert.alert('Ошибка', 'Не удалось удалить товар');
            }
          }
        }
      ]
    );
  };

  const renderProduct = ({ item }) => {
    const imageUrl = item.thumbnail_url || item.image_url;
    const fullImageUrl = imageUrl ? (imageUrl.startsWith('http') ? imageUrl : `${API_BASE_URL}${imageUrl}`) : null;

    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Image 
          source={{ uri: fullImageUrl || 'https://via.placeholder.com/150' }} 
          style={styles.image} 
        />
        <View style={styles.cardInfo}>
          <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.cardSubtitle, { color: colors.primary }]}>{item.price} ₽</Text>
          <Text style={[styles.cardDetail, { color: colors.textSecondary }]}>Склад: {item.stock} шт.</Text>
          <Text style={[styles.cardDetail, { color: colors.textSecondary }]}>Статус: {item.moderation_status}</Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity 
            style={[styles.actionButton, { backgroundColor: colors.primary }]}
            onPress={() => navigation.navigate('EditProduct', { product: item })}
          >
            <Icon name="create-outline" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.actionButton, { backgroundColor: colors.error, marginTop: 10 }]}
            onPress={() => deleteProduct(item.id)}
          >
            <Icon name="trash-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

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
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Товаров не найдено</Text>
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
    flexDirection: 'row',
    padding: 10,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  image: {
    width: 80,
    height: 80,
    borderRadius: 8,
    marginRight: 15,
  },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: 'bold' },
  cardSubtitle: { fontSize: 16, fontWeight: 'bold', marginTop: 2 },
  cardDetail: { fontSize: 12, marginTop: 2 },
  actions: { marginLeft: 10 },
  actionButton: { padding: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  emptyText: { textAlign: 'center', marginTop: 50, fontSize: 16 },
});
