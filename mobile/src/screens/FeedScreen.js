import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import FadeInImage from '../components/FadeInImage';
import FadeInView from '../components/FadeInView';
import { productsApi, newsApi, usersApi, cartApi } from '../api';
import { getFullUrl } from '../utils/urlHelper';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

export default function FeedScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [activeTab, setActiveTab] = useState('news'); // 'news' or 'products'
  const [products, setProducts] = useState([]);
  const [news, setNews] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [cartItems, setCartItems] = useState([]);
  const [updatingProductId, setUpdatingProductId] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const [productsRes, newsRes, userRes, cartRes] = await Promise.all([
        productsApi.getProducts().catch(() => ({ data: { items: [] } })),
        newsApi.getNews().catch(() => ({ data: [] })),
        usersApi.getMe().catch(() => ({ data: null })),
        cartApi.getCart().catch(() => ({ data: { items: [] } }))
      ]);
      
      const cartItemsData = cartRes?.data?.items || [];
      setCartItems(cartItemsData);
      const cartCount = cartItemsData.reduce((acc, item) => acc + item.quantity, 0);

      navigation.setOptions({
        headerRight: () => (
          <TouchableOpacity 
            style={{ marginRight: 15 }} 
            onPress={() => navigation.navigate('Cart')}
          >
            <View>
              <Icon name="cart-outline" size={24} color={colors.text} />
              {cartCount > 0 && (
                <View style={[styles.cartBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.cartBadgeText}>{cartCount}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        ),
      });

      let productsData = productsRes.data.items || productsRes.data;
      if (userRes?.data) {
        setUser(userRes.data);
        // Если это продавец, админ или владелец, загружаем ИХ товары отдельно, чтобы увидеть pending
        if (userRes.data.role !== 'buyer') {
          try {
            const sellerProductsRes = await productsApi.getProducts({ seller_id: userRes.data.id });
            const sellerProducts = sellerProductsRes.data.items || sellerProductsRes.data;
            
            // Объединяем общие одобренные товары с собственными (включая pending)
            const combinedProducts = [...productsData];
            sellerProducts.forEach(sp => {
              if (!combinedProducts.find(p => p.id === sp.id)) {
                combinedProducts.push(sp);
              }
            });
            productsData = combinedProducts.sort((a, b) => b.id - a.id);
          } catch (sellerErr) {
            console.log('Failed to load seller products', sellerErr);
          }
        }
      }
      setProducts(productsData);
      setNews(newsRes.data);
    } catch (err) {
      console.log(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const canManageNews = user?.role === 'admin' || user?.role === 'owner';
  const canManageProducts = user?.role === 'seller' || user?.role === 'admin' || user?.role === 'owner';

  const renderNewsItem = ({ item }) => {
    const stripHtml = (html) => {
      if (!html) return '';
      return html.replace(/<[^>]*>?/gm, '');
    };
    
    const newsThumbnail = item.images && item.images.length > 0 
      ? item.images[0].thumbnail_url 
      : item.image_url;

    return (
      <TouchableOpacity 
        style={[styles.newsCard, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: theme === 'dark' ? 1 : 0 }]}
        onPress={() => navigation.navigate('NewsDetail', { newsId: item.id, newsItem: item })}
      >
        <View style={styles.newsRow}>
          {newsThumbnail && (
            <FadeInImage 
              source={{ uri: getFullUrl(newsThumbnail) }} 
              style={styles.newsThumbnail} 
            />
          )}
          <View style={styles.newsTextContainer}>
            <View style={styles.newsHeader}>
              <Text style={[styles.newsTitle, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
              {canManageNews && (
                <TouchableOpacity onPress={(e) => {
                  e.stopPropagation();
                  navigation.navigate('EditNews', { newsItem: item });
                }}>
                  <Icon name="create-outline" size={20} color={colors.primary} />
                </TouchableOpacity>
              )}
            </View>
            <Text style={[styles.newsContent, { color: colors.textSecondary }]} numberOfLines={2}>
              {stripHtml(item.content)}
            </Text>
            <View style={styles.newsFooter}>
              <Text style={[styles.newsDate, { color: colors.textSecondary }]}>{new Date(item.created_at).toLocaleDateString()}</Text>
              <View style={styles.reactionsRow}>
                <View style={styles.reactionItem}>
                  <Icon name={item.my_reaction === 1 ? "heart" : "heart-outline"} size={14} color={item.my_reaction === 1 ? colors.error : colors.textSecondary} />
                  <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>{item.likes_count || 0}</Text>
                </View>
                <View style={[styles.reactionItem, { marginLeft: 10 }]}>
                  <Icon name={item.my_reaction === -1 ? "thumbs-down" : "thumbs-down-outline"} size={14} color={item.my_reaction === -1 ? colors.primary : colors.textSecondary} />
                  <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>{item.dislikes_count || 0}</Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const handleAddToCart = async (product) => {
    try {
      setUpdatingProductId(product.id);
      await cartApi.addItem(product.id, 1);
      await loadData(); // Обновляем данные и счетчик
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось добавить товар в корзину');
    } finally {
      setUpdatingProductId(null);
    }
  };

  const handleUpdateQuantity = async (productId, currentQuantity, delta) => {
    const newQuantity = currentQuantity + delta;
    try {
      setUpdatingProductId(productId);
      if (newQuantity <= 0) {
        await cartApi.removeItem(productId);
      } else {
        await cartApi.updateItem(productId, newQuantity);
      }
      await loadData();
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось обновить количество');
    } finally {
      setUpdatingProductId(null);
    }
  };

  const renderProductItem = ({ item }) => {
    const isOwnerOrAdmin = user && (user.id === item.seller_id || user.role === 'admin' || user.role === 'owner');
    const isPending = item.moderation_status === 'pending';
    const cartItem = cartItems.find(ci => ci.product_id === item.id);
    const quantityInCart = cartItem ? cartItem.quantity : 0;
    const isUpdating = updatingProductId === item.id;
    
    return (
      <TouchableOpacity 
        style={[
          styles.productGridCard, 
          { backgroundColor: colors.card, borderColor: isPending ? colors.warning || '#ffcc00' : colors.border, borderWidth: (theme === 'dark' || isPending) ? 1 : 0 }
        ]}
        onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
      >
        <FadeInImage source={{ uri: getFullUrl(item.thumbnail_url) || 'https://via.placeholder.com/150' }} style={styles.productGridImage} />
        {isPending && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>Ожидает</Text>
          </View>
        )}
        <View style={styles.productInfo}>
          <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>{item.name}</Text>
          <View style={styles.productFooter}>
            <Text style={[styles.productPrice, { color: colors.primary }]}>{item.price} руб.</Text>
            
            {user?.role === 'buyer' && (
              <View style={styles.cartActions}>
                {quantityInCart > 0 ? (
                  <View style={styles.quantityControls}>
                    <TouchableOpacity 
                      onPress={() => handleUpdateQuantity(item.id, quantityInCart, -1)}
                      disabled={isUpdating}
                    >
                      <Icon name="remove-circle-outline" size={24} color={colors.primary} />
                    </TouchableOpacity>
                    <Text style={[styles.quantityText, { color: colors.text }]}>{quantityInCart}</Text>
                    <TouchableOpacity 
                      onPress={() => handleUpdateQuantity(item.id, quantityInCart, 1)}
                      disabled={isUpdating}
                    >
                      <Icon name="add-circle-outline" size={24} color={colors.primary} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity 
                    style={[styles.miniEditButton, { backgroundColor: colors.primary }]}
                    onPress={() => handleAddToCart(item)}
                    disabled={isUpdating}
                  >
                    {isUpdating ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Icon name="cart-outline" size={16} color="#fff" />
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}

            {(canManageProducts && isOwnerOrAdmin) && (
              <View style={[styles.miniEditButton, { backgroundColor: colors.primary }]}>
                <Icon name="create-outline" size={16} color="#fff" />
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'news' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]} 
          onPress={() => setActiveTab('news')}
        >
          <Text style={[styles.tabText, { color: activeTab === 'news' ? colors.primary : colors.textSecondary }]}>Новости</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'products' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]} 
          onPress={() => setActiveTab('products')}
        >
          <Text style={[styles.tabText, { color: activeTab === 'products' ? colors.primary : colors.textSecondary }]}>Продукты</Text>
        </TouchableOpacity>
      </View>

      {loading && !refreshing ? (
        <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
      ) : (
        <FadeInView visible={!loading} duration={250}>
          <FlatList
          data={activeTab === 'news' ? news : products}
          keyExtractor={(item) => item.id.toString()}
          renderItem={activeTab === 'news' ? renderNewsItem : renderProductItem}
          contentContainerStyle={styles.listContent}
          numColumns={activeTab === 'products' ? 2 : 1}
          key={activeTab} // Force re-render when switching tabs to change numColumns
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
          ListEmptyComponent={
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {activeTab === 'news' ? 'Нет новостей' : 'Нет продуктов'}
            </Text>
          }
        />
        </FadeInView>
      )}

      {((activeTab === 'news' && canManageNews) || (activeTab === 'products' && canManageProducts)) && (
        <TouchableOpacity 
          style={[styles.fab, { backgroundColor: colors.primary }]}
          onPress={() => navigation.navigate(activeTab === 'news' ? 'EditNews' : 'EditProduct')}
        >
          <Icon name="add-outline" size={30} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, paddingVertical: 15, alignItems: 'center' },
  tabText: { fontSize: 16, fontWeight: 'bold' },
  listContent: { padding: 10 },
  newsCard: { borderRadius: 12, marginBottom: 12, elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, overflow: 'hidden' },
  newsRow: { flexDirection: 'row' },
  newsThumbnail: { width: 100, height: 100, borderRadius: 0 },
  newsTextContainer: { flex: 1, padding: 12, justifyContent: 'space-between' },
  newsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  newsTitle: { fontSize: 16, fontWeight: 'bold', flex: 1, marginRight: 8 },
  newsContent: { fontSize: 13, marginBottom: 8, lineHeight: 18 },
  newsFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  newsDate: { fontSize: 11, color: 'gray' },
  reactionsRow: { flexDirection: 'row', alignItems: 'center' },
  reactionItem: { flexDirection: 'row', alignItems: 'center' },
  reactionCount: { fontSize: 12, marginLeft: 4 },
  productGridCard: { flex: 0.5, margin: 5, borderRadius: 10, elevation: 2, overflow: 'hidden' },
  productGridImage: { width: '100%', height: 150 },
  productInfo: { padding: 10 },
  productName: { fontSize: 14, fontWeight: '500', marginBottom: 5, height: 40 },
  productFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  productPrice: { fontSize: 16, fontWeight: 'bold', flex: 1 },
  miniEditButton: { padding: 5, borderRadius: 15, elevation: 2, marginLeft: 5, minWidth: 30, alignItems: 'center' },
  cartActions: { flexDirection: 'row', alignItems: 'center' },
  quantityControls: { flexDirection: 'row', alignItems: 'center' },
  quantityText: { marginHorizontal: 8, fontSize: 14, fontWeight: 'bold' },
  cartBadge: {
    position: 'absolute',
    right: -6,
    top: -6,
    borderRadius: 9,
    width: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fff',
  },
  cartBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  pendingBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    backgroundColor: 'rgba(255, 204, 0, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  pendingBadgeText: {
    color: '#000',
    fontSize: 10,
    fontWeight: 'bold',
  },
  fab: { position: 'absolute', bottom: 20, right: 20, width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 4.65 },
  emptyText: { textAlign: 'center', marginTop: 50, fontSize: 16 },
});
