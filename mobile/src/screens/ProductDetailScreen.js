import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Image, ScrollView, TouchableOpacity, FlatList, ActivityIndicator, Alert, TextInput, Dimensions } from 'react-native';
import { productsApi, usersApi, cartApi } from '../api';
import { getFullUrl } from '../utils/urlHelper';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { Ionicons as Icon } from '@expo/vector-icons';
import { formatName } from '../utils/formatters';

const { width } = Dimensions.get('window');

export default function ProductDetailScreen({ route, navigation }) {
  const { productId } = route.params;
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  
  const [product, setProduct] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [productRes, reviewsRes, userRes] = await Promise.all([
        productsApi.getProduct(productId),
        productsApi.getReviews(productId),
        usersApi.getMe().catch(() => ({ data: null }))
      ]);
      setProduct(productRes.data);
      setReviews(reviewsRes.data);
      setUser(userRes.data);
    } catch (err) {
      console.error(err);
      Alert.alert('Ошибка', 'Не удалось загрузить данные о товаре');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSubmitReview = async () => {
    if (!user) {
      Alert.alert('Ошибка', 'Для того чтобы оставить отзыв, необходимо войти в систему');
      return;
    }
    if (comment.trim().length < 5) {
      Alert.alert('Ошибка', 'Комментарий слишком короткий');
      return;
    }

    setSubmittingReview(true);
    try {
      await productsApi.createReview({
        product_id: productId,
        grade: rating,
        comment: comment.trim()
      });
      setComment('');
      setRating(5);
      loadData();
      Alert.alert('Успех', 'Отзыв успешно добавлен');
    } catch (err) {
      console.error(err);
      Alert.alert('Ошибка', 'Не удалось отправить отзыв');
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleAddToCart = async () => {
    try {
      await cartApi.addItem(productId, 1);
      Alert.alert('Успех', 'Товар добавлен в корзину');
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось добавить товар в корзину');
    }
  };

  if (loading || !product) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const allImages = product.images && product.images.length > 0 
    ? product.images 
    : [{ image_url: product.image_url, id: 'main' }];

  const renderReview = ({ item }) => (
    <View style={[styles.reviewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.reviewHeader}>
        <TouchableOpacity 
          onPress={() => navigation.navigate('UserProfile', { userId: item.user_id })}
          style={styles.reviewUserContainer}
        >
          <Image 
            source={{ uri: getFullUrl(item.avatar_url) || 'https://via.placeholder.com/40' }} 
            style={styles.reviewAvatar} 
          />
          <Text style={[styles.reviewUser, { color: colors.text }]}>
            {item.first_name ? `${item.first_name} ${item.last_name || ''}` : `Пользователь #${item.user_id}`}
          </Text>
        </TouchableOpacity>
        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map(s => (
            <Icon key={s} name={s <= item.grade ? "star" : "star-outline"} size={14} color="#FFD700" />
          ))}
        </View>
      </View>
      <Text style={[styles.reviewComment, { color: colors.text }]}>{item.comment}</Text>
      <Text style={[styles.reviewDate, { color: colors.textSecondary }]}>
        {new Date(item.comment_date).toLocaleDateString()}
      </Text>
    </View>
  );

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.imageContainer}>
        <FlatList
          data={allImages}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const index = Math.round(e.nativeEvent.contentOffset.x / width);
            setActiveImageIndex(index);
          }}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <Image 
              source={{ uri: getFullUrl(item.image_url) || 'https://via.placeholder.com/400' }} 
              style={styles.image} 
              resizeMode="cover"
            />
          )}
        />
        {allImages.length > 1 && (
          <View style={styles.pagination}>
            {allImages.map((_, i) => (
              <View 
                key={i} 
                style={[
                  styles.paginationDot, 
                  { backgroundColor: i === activeImageIndex ? colors.primary : 'rgba(255,255,255,0.5)' }
                ]} 
              />
            ))}
          </View>
        )}
      </View>

      <View style={styles.infoContainer}>
        <Text style={[styles.name, { color: colors.text }]}>{product.name}</Text>
        <View style={styles.priceRow}>
          <Text style={[styles.price, { color: colors.primary }]}>{product.price} руб.</Text>
          {product.rating && (
            <View style={styles.ratingBadge}>
              <Icon name="star" size={16} color="#FFD700" />
              <Text style={styles.ratingText}>{product.rating.toFixed(1)}</Text>
            </View>
          )}
        </View>
        
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Описание</Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          {product.description || 'Описание отсутствует'}
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Наличие</Text>
        <Text style={[styles.stock, { color: product.stock > 0 ? '#4CAF50' : colors.error }]}>
          {product.stock > 0 ? `В наличии: ${product.stock} шт.` : 'Нет в наличии'}
        </Text>

        {user?.role === 'buyer' && product.stock > 0 && (
          <TouchableOpacity 
            style={[styles.addToCartButton, { backgroundColor: colors.primary }]}
            onPress={handleAddToCart}
          >
            <Icon name="cart-outline" size={24} color="#fff" />
            <Text style={styles.addToCartText}>Добавить в корзину</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.reviewsContainer}>
        <Text style={[styles.sectionTitle, { color: colors.text, marginHorizontal: 20 }]}>Отзывы ({reviews.length})</Text>
        
        {user?.role === 'buyer' && (
          <View style={[styles.addReview, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.addReviewTitle, { color: colors.text }]}>Оставить отзыв</Text>
            <View style={styles.ratingPicker}>
              {[1, 2, 3, 4, 5].map(s => (
                <TouchableOpacity key={s} onPress={() => setRating(s)}>
                  <Icon name={s <= rating ? "star" : "star-outline"} size={30} color="#FFD700" />
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.commentInput, { color: colors.text, borderColor: colors.border }]}
              placeholder="Ваш комментарий..."
              placeholderTextColor={colors.textSecondary}
              multiline
              value={comment}
              onChangeText={setComment}
            />
            <TouchableOpacity 
              style={[styles.submitButton, { backgroundColor: colors.primary }]}
              onPress={handleSubmitReview}
              disabled={submittingReview}
            >
              {submittingReview ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>Отправить</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <FlatList
          data={reviews}
          renderItem={renderReview}
          keyExtractor={(item) => item.id.toString()}
          scrollEnabled={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
          ListEmptyComponent={
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Пока нет отзывов</Text>
          }
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  imageContainer: { width: width, height: 300, position: 'relative' },
  image: { width: width, height: 300 },
  pagination: { 
    position: 'absolute', 
    bottom: 15, 
    width: '100%', 
    flexDirection: 'row', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  paginationDot: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 4 },
  infoContainer: { padding: 20 },
  name: { fontSize: 24, fontWeight: 'bold', marginBottom: 10 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  price: { fontSize: 22, fontWeight: 'bold' },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 215, 0, 0.1)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 15 },
  ratingText: { marginLeft: 5, fontWeight: 'bold', color: '#B8860B' },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginTop: 20, marginBottom: 10 },
  description: { fontSize: 16, lineHeight: 24 },
  stock: { fontSize: 16, fontWeight: '600' },
  addToCartButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 15, borderRadius: 12, marginTop: 30 },
  addToCartText: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginLeft: 10 },
  reviewsContainer: { marginTop: 20 },
  reviewCard: { padding: 15, borderRadius: 12, marginBottom: 15, borderWidth: 1 },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  reviewUserContainer: { flexDirection: 'row', alignItems: 'center' },
  reviewAvatar: { width: 30, height: 30, borderRadius: 15, marginRight: 10 },
  reviewUser: { fontWeight: 'bold' },
  stars: { flexDirection: 'row' },
  reviewComment: { fontSize: 15, marginBottom: 5 },
  reviewDate: { fontSize: 12 },
  emptyText: { textAlign: 'center', marginTop: 10 },
  addReview: { margin: 20, padding: 15, borderRadius: 12, borderWidth: 1 },
  addReviewTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  ratingPicker: { flexDirection: 'row', justifyContent: 'center', marginBottom: 15 },
  commentInput: { borderWidth: 1, borderRadius: 8, padding: 10, height: 80, textAlignVertical: 'top', marginBottom: 15 },
  submitButton: { padding: 12, borderRadius: 8, alignItems: 'center' },
  submitButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
