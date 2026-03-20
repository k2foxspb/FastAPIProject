import React, { useState, useEffect, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Image, 
  ScrollView, 
  TouchableOpacity, 
  FlatList, 
  ActivityIndicator, 
  Alert, 
  TextInput, 
  Dimensions, 
  Platform, 
  KeyboardAvoidingView 
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { productsApi, usersApi, cartApi } from '../api';
import { getFullUrl } from '../utils/urlHelper';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { Ionicons as Icon } from '@expo/vector-icons';
import { formatName } from '../utils/formatters';
import { useNotifications } from '../context/NotificationContext';

const { width } = Dimensions.get('window');

export default function ProductDetailScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { productId } = route.params;
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser } = useNotifications();
  
  const [product, setProduct] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(currentUser);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const promises = [
        productsApi.getProduct(productId),
        productsApi.getReviews(productId),
      ];
      
      let userData = currentUser;
      const results = await Promise.all(promises);
      const [productRes, reviewsRes] = results;
      
      if (!userData) {
        try {
          const uRes = await usersApi.getMe();
          userData = uRes.data;
        } catch (e) {}
      }
      
      setProduct(productRes.data);
      setReviews(reviewsRes.data);
      setUser(userData);
    } catch (err) {
      console.error(err);
      Alert.alert('Ошибка', 'Не удалось загрузить данные о товаре');
    } finally {
      setLoading(false);
    }
  }, [productId, currentUser]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSubmitReview = async () => {
    if (!currentUser) {
      Alert.alert(
        'Авторизация',
        'Войдите в аккаунт, чтобы оставить отзыв',
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Войти', onPress: () => navigation.navigate('Profile', { screen: 'Login' }) }
        ]
      );
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
    if (!currentUser) {
      Alert.alert(
        'Авторизация',
        'Войдите в аккаунт, чтобы добавить товар в корзину',
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Войти', onPress: () => navigation.navigate('Profile', { screen: 'Login' }) }
        ]
      );
      return;
    }
    try {
      await cartApi.addItem(productId, 1);
      Alert.alert('Успех', 'Товар добавлен в корзину');
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось добавить товар в корзину');
    }
  };

  const handleReviewReaction = async (reviewId, type) => {
    if (!currentUser) {
      Alert.alert(
        'Авторизация',
        'Войдите в аккаунт, чтобы ставить реакции',
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Войти', onPress: () => navigation.navigate('Profile', { screen: 'Login' }) }
        ]
      );
      return;
    }
    try {
      const review = reviews.find(r => r.id === reviewId);
      if (!review) return;

      const newReaction = review.my_reaction === type ? 0 : type;
      await productsApi.reactToReview(reviewId, newReaction);
      
      setReviews(prev => prev.map(r => {
        if (r.id === reviewId) {
          let likes = r.likes_count || 0;
          let dislikes = r.dislikes_count || 0;
          
          if (r.my_reaction === 1) likes--;
          if (r.my_reaction === -1) dislikes--;
          
          if (newReaction === 1) likes++;
          if (newReaction === -1) dislikes++;
          
          return {
            ...r,
            my_reaction: newReaction,
            likes_count: likes,
            dislikes_count: dislikes
          };
        }
        return r;
      }));
    } catch (err) {
      if (err.response?.status === 401) {
        Alert.alert('Авторизация', 'Войдите в аккаунт, чтобы ставить реакции');
      } else {
        Alert.alert('Ошибка', 'Не удалось отправить реакцию');
      }
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
      <View style={styles.reviewFooter}>
        <Text style={[styles.reviewDate, { color: colors.textSecondary }]}>
          {new Date(item.comment_date).toLocaleDateString()}
        </Text>
        <View style={styles.commentReactions}>
          <TouchableOpacity 
            onPress={() => handleReviewReaction(item.id, 1)}
            style={styles.commentReactionButton}
          >
            <Icon 
              name={item.my_reaction === 1 ? "heart" : "heart-outline"} 
              size={16} 
              color={item.my_reaction === 1 ? colors.error : colors.textSecondary} 
            />
            <Text style={[styles.commentReactionText, { color: colors.textSecondary }]}>
              {item.likes_count || 0}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            onPress={() => handleReviewReaction(item.id, -1)}
            style={[styles.commentReactionButton, { marginLeft: 15 }]}
          >
            <Icon 
              name={item.my_reaction === -1 ? "thumbs-down" : "thumbs-down-outline"} 
              size={16} 
              color={item.my_reaction === -1 ? colors.primary : colors.textSecondary} 
            />
            <Text style={[styles.commentReactionText, { color: colors.textSecondary }]}>
              {item.dislikes_count || 0}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView 
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior="padding" 
      keyboardVerticalOffset={90}
      enabled={Platform.OS !== 'web'}
    >
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

      {user?.role === 'buyer' && (
        <View style={[styles.stickyAddReview, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={styles.stickyReviewRow}>
            <View style={styles.ratingPickerMini}>
              {[1, 2, 3, 4, 5].map(s => (
                <TouchableOpacity key={s} onPress={() => setRating(s)}>
                  <Icon name={s <= rating ? "star" : "star-outline"} size={22} color="#FFD700" />
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.stickyCommentInput, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder="Ваш отзыв..."
              placeholderTextColor={colors.textSecondary}
              multiline
              value={comment}
              onChangeText={setComment}
            />
            <TouchableOpacity 
              style={[styles.stickySubmitButton, { backgroundColor: colors.primary }]}
              onPress={handleSubmitReview}
              disabled={submittingReview || !comment.trim()}
            >
              {submittingReview ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Icon name="send" size={20} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
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
  reviewComment: { fontSize: 15, marginBottom: 8 },
  reviewDate: { fontSize: 12, flex: 1 },
  reviewFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  commentReactions: { flexDirection: 'row', alignItems: 'center' },
  commentReactionButton: { flexDirection: 'row', alignItems: 'center' },
  commentReactionText: { marginLeft: 4, fontSize: 12 },
  emptyText: { textAlign: 'center', marginTop: 10 },
  stickyAddReview: { 
    padding: 10, 
    borderTopWidth: 1,
  },
  stickyReviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingPickerMini: {
    flexDirection: 'row',
    marginRight: 10,
  },
  stickyCommentInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 8,
    maxHeight: 100,
    fontSize: 14,
  },
  stickySubmitButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
});
