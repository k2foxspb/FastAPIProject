import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import api from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { Ionicons as Icon } from '@expo/vector-icons';

export default function AdminReviewsScreen() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const fetchReviews = async () => {
    try {
      const res = await api.get('/admin/reviews');
      setReviews(res.data);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить отзывы');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, []);

  const deleteReview = (id) => {
    Alert.alert(
      'Удаление',
      'Вы уверены, что хотите удалить этот отзыв?',
      [
        { text: 'Отмена', style: 'cancel' },
        { 
          text: 'Удалить', 
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/admin/reviews/${id}`);
              fetchReviews();
            } catch (err) {
              Alert.alert('Ошибка', 'Не удалось удалить отзыв');
            }
          }
        }
      ]
    );
  };

  const renderStars = (grade) => {
    let stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <Icon 
          key={i} 
          name={i <= grade ? "star" : "star-outline"} 
          size={16} 
          color={i <= grade ? "#FFD700" : colors.textSecondary} 
        />
      );
    }
    return <View style={styles.stars}>{stars}</View>;
  };

  const renderReview = ({ item }) => (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={[styles.userName, { color: colors.text }]}>
            {item.first_name || item.last_name ? `${item.first_name || ''} ${item.last_name || ''}` : 'Аноним'}
          </Text>
          <Text style={[styles.cardDetail, { color: colors.textSecondary }]}>Пользователь ID: {item.user_id}</Text>
        </View>
        {renderStars(item.grade)}
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.productInfo, { color: colors.textSecondary }]}>Товар ID: {item.product_id}</Text>
        <Text style={[styles.comment, { color: colors.text }]}>{item.comment}</Text>
        <Text style={[styles.date, { color: colors.textSecondary }]}>{new Date(item.comment_date).toLocaleString()}</Text>
      </View>
      <TouchableOpacity 
        style={[styles.deleteButton, { backgroundColor: colors.error }]}
        onPress={() => deleteReview(item.id)}
      >
        <Icon name="trash-outline" size={18} color="#fff" />
      </TouchableOpacity>
    </View>
  );

  if (loading && reviews.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={reviews}
        keyExtractor={item => item.id.toString()}
        renderItem={renderReview}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={fetchReviews}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Отзывов не найдено</Text>
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
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  userName: { fontSize: 16, fontWeight: 'bold' },
  stars: { flexDirection: 'row' },
  cardBody: { marginBottom: 10 },
  productInfo: { fontSize: 12, marginBottom: 5 },
  comment: { fontSize: 14, fontStyle: 'italic' },
  date: { fontSize: 12, marginTop: 10 },
  cardDetail: { fontSize: 12 },
  deleteButton: { 
    position: 'absolute', 
    bottom: 15, 
    right: 15, 
    padding: 8, 
    borderRadius: 8 
  },
  emptyText: { textAlign: 'center', marginTop: 50, fontSize: 16 },
});
