import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, Image, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { usersApi } from '../api';
import { getFullUrl } from '../utils/urlHelper';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { Ionicons as Icon } from '@expo/vector-icons';

export default function MyReviewsScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const res = await usersApi.getMyReviews();
      setReviews(res.data);
    } catch (err) {
      console.log(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const renderReview = ({ item }) => (
    <View style={[styles.reviewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.reviewHeader}>
        <View style={styles.reviewUserContainer}>
          <Image 
            source={{ uri: getFullUrl(item.avatar_url) || 'https://via.placeholder.com/40' }} 
            style={styles.reviewAvatar} 
          />
          <View>
            <Text style={[styles.reviewUser, { color: colors.text }]}>
              {item.first_name ? `${item.first_name} ${item.last_name || ''}` : `Пользователь #${item.user_id}`}
            </Text>
            <TouchableOpacity onPress={() => navigation.navigate('ProductDetail', { productId: item.product_id })}>
              <Text style={[styles.productLink, { color: colors.primary }]}>К товару #{item.product_id}</Text>
            </TouchableOpacity>
          </View>
        </View>
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

  if (loading && !refreshing) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={reviews}
        renderItem={renderReview}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ padding: 20 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="chatbubble-ellipses-outline" size={60} color={colors.textSecondary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Вы еще не оставили ни одного отзыва
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  reviewCard: {
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 15,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  reviewUserContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reviewAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
  },
  reviewUser: {
    fontWeight: 'bold',
    fontSize: 14,
  },
  productLink: {
    fontSize: 12,
    marginTop: 2,
  },
  stars: {
    flexDirection: 'row',
  },
  reviewComment: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 8,
  },
  reviewDate: {
    fontSize: 12,
  },
  emptyContainer: { alignItems: 'center', marginTop: 100 },
  emptyText: { textAlign: 'center', marginTop: 20, fontSize: 16 },
});
