import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, Image, StyleSheet, ScrollView } from 'react-native';
import { productsApi } from '../api';

export default function FeedScreen() {
  const [products, setProducts] = useState([]);
  const [news, setNews] = useState([
    { id: 1, title: 'Добро пожаловать в наш магазин!', date: '13.02.2026' },
    { id: 2, title: 'Скидки на все товары до конца недели!', date: '12.02.2026' },
  ]);

  useEffect(() => {
    productsApi.getProducts().then(res => setProducts(res.data)).catch(err => console.log(err));
  }, []);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Последние новости</Text>
        {news.map(item => (
          <View key={item.id} style={styles.newsCard}>
            <Text style={styles.newsTitle}>{item.title}</Text>
            <Text style={styles.newsDate}>{item.date}</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Продукты для покупки</Text>
        <FlatList
          horizontal
          data={products}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <View style={styles.productCard}>
              <Image source={{ uri: item.thumbnail_url || 'https://via.placeholder.com/150' }} style={styles.productImage} />
              <Text style={styles.productName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.productPrice}>{item.price} руб.</Text>
            </View>
          )}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f9f9' },
  section: { padding: 20 },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 15 },
  newsCard: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 10, elevation: 2 },
  newsTitle: { fontSize: 16, fontWeight: '500' },
  newsDate: { fontSize: 12, color: 'gray', marginTop: 5 },
  productCard: { backgroundColor: '#fff', width: 140, marginRight: 15, padding: 10, borderRadius: 10, elevation: 2 },
  productImage: { width: 120, height: 120, borderRadius: 8 },
  productName: { marginTop: 10, fontSize: 14, fontWeight: '500' },
  productPrice: { color: '#007AFF', fontWeight: 'bold', marginTop: 5 },
});
