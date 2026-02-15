import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, Image, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { productsApi, newsApi } from '../api';
import { getFullUrl } from '../utils/urlHelper';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function FeedScreen() {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [products, setProducts] = useState([]);
  const [news, setNews] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [productsRes, newsRes] = await Promise.all([
        productsApi.getProducts(),
        newsApi.getNews()
      ]);
      setProducts(productsRes.data.items || productsRes.data);
      setNews(newsRes.data);
    } catch (err) {
      console.log(err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  return (
    <ScrollView 
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Последние новости</Text>
        {news.length > 0 ? news.map(item => (
          <View key={item.id} style={[styles.newsCard, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: theme === 'dark' ? 1 : 0 }]}>
            <Text style={[styles.newsTitle, { color: colors.text }]}>{item.title}</Text>
            <Text style={[styles.newsDate, { color: colors.textSecondary }]}>{new Date(item.created_at).toLocaleDateString()}</Text>
          </View>
        )) : (
          <Text style={{ color: colors.textSecondary }}>Нет новостей</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Продукты для покупки</Text>
        <FlatList
          horizontal
          data={products}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <View style={[styles.productCard, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: theme === 'dark' ? 1 : 0 }]}>
              <Image source={{ uri: getFullUrl(item.thumbnail_url) || 'https://via.placeholder.com/150' }} style={styles.productImage} />
              <Text style={[styles.productName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
              <Text style={[styles.productPrice, { color: colors.primary }]}>{item.price} руб.</Text>
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
