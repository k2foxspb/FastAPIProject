import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image, ScrollView, Dimensions, ActivityIndicator, Alert, FlatList, TouchableOpacity } from 'react-native';
import RenderHTML from 'react-native-render-html';
import { newsApi } from '../api';
import { getFullUrl } from '../utils/urlHelper';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { Ionicons as Icon } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

export default function NewsDetailScreen({ route, navigation }) {
  const { newsId, newsItem: initialNewsItem } = route.params;
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  
  const [news, setNews] = useState(initialNewsItem || null);
  const [loading, setLoading] = useState(!initialNewsItem);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  useEffect(() => {
    if (!news) {
      loadNews();
    }
  }, []);

  const loadNews = async () => {
    try {
      setLoading(true);
      const res = await newsApi.getNewsDetail(newsId);
      setNews(res.data);
    } catch (err) {
      console.error(err);
      Alert.alert('Ошибка', 'Не удалось загрузить новость');
    } finally {
      setLoading(false);
    }
  };

  if (loading || !news) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const handleReaction = async (type) => {
    try {
      const newReaction = news.my_reaction === type ? 0 : type;
      await newsApi.reactToNews(newsId, newReaction);
      
      // Обновляем локальное состояние
      setNews(prev => {
        let likes = prev.likes_count || 0;
        let dislikes = prev.dislikes_count || 0;
        
        // Убираем старую реакцию
        if (prev.my_reaction === 1) likes--;
        if (prev.my_reaction === -1) dislikes--;
        
        // Добавляем новую
        if (newReaction === 1) likes++;
        if (newReaction === -1) dislikes++;
        
        return {
          ...prev,
          my_reaction: newReaction,
          likes_count: likes,
          dislikes_count: dislikes
        };
      });
    } catch (err) {
      console.error(err);
      // Если 401, то просто не авторизован
      if (err.response?.status === 401) {
        Alert.alert('Авторизация', 'Войдите в аккаунт, чтобы ставить реакции');
      } else {
        Alert.alert('Ошибка', 'Не удалось отправить реакцию');
      }
    }
  };

  const allImages = news.images && news.images.length > 0 
    ? news.images 
    : (news.image_url ? [{ image_url: news.image_url, id: 'main' }] : []);

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      {allImages.length > 0 && (
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
                source={{ uri: getFullUrl(item.image_url) }} 
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
      )}

      <View style={styles.contentContainer}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.text }]}>{news.title}</Text>
            <Text style={[styles.date, { color: colors.textSecondary }]}>
              {new Date(news.created_at).toLocaleDateString()} {new Date(news.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
          <View style={styles.reactionsContainer}>
            <TouchableOpacity 
              style={[styles.reactionButton, { backgroundColor: news.my_reaction === 1 ? colors.error + '20' : colors.surface }]} 
              onPress={() => handleReaction(1)}
            >
              <Icon name={news.my_reaction === 1 ? "heart" : "heart-outline"} size={24} color={news.my_reaction === 1 ? colors.error : colors.textSecondary} />
              <Text style={[styles.reactionText, { color: news.my_reaction === 1 ? colors.error : colors.textSecondary }]}>{news.likes_count || 0}</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.reactionButton, { marginLeft: 10, backgroundColor: news.my_reaction === -1 ? colors.primary + '20' : colors.surface }]} 
              onPress={() => handleReaction(-1)}
            >
              <Icon name={news.my_reaction === -1 ? "thumbs-down" : "thumbs-down-outline"} size={24} color={news.my_reaction === -1 ? colors.primary : colors.textSecondary} />
              <Text style={[styles.reactionText, { color: news.my_reaction === -1 ? colors.primary : colors.textSecondary }]}>{news.dislikes_count || 0}</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <RenderHTML
          contentWidth={width - 40}
          source={{ html: news.content }}
          tagsStyles={{
            body: { color: colors.text, fontSize: 16, lineHeight: 24 },
            p: { marginBottom: 10 },
            img: { borderRadius: 8, marginVertical: 10 },
          }}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  imageContainer: { width: width, height: 250, position: 'relative' },
  image: { width: width, height: 250 },
  pagination: { 
    position: 'absolute', 
    bottom: 15, 
    width: '100%', 
    flexDirection: 'row', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  paginationDot: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 4 },
  contentContainer: { padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 10 },
  date: { fontSize: 14, marginBottom: 15 },
  divider: { height: 1, width: '100%', marginBottom: 20 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  reactionsContainer: { flexDirection: 'row', alignItems: 'center' },
  reactionButton: { flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 12, borderWidth: 1, borderColor: 'transparent' },
  reactionText: { marginLeft: 6, fontWeight: 'bold', fontSize: 16 },
  content: { fontSize: 16, lineHeight: 26 },
});
