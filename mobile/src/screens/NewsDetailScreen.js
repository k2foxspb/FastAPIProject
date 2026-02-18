import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image, ScrollView, Dimensions, ActivityIndicator, Alert, FlatList } from 'react-native';
import RenderHTML from 'react-native-render-html';
import { newsApi } from '../api';
import { getFullUrl } from '../utils/urlHelper';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

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
        <Text style={[styles.title, { color: colors.text }]}>{news.title}</Text>
        <Text style={[styles.date, { color: colors.textSecondary }]}>
          {new Date(news.created_at).toLocaleDateString()} {new Date(news.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
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
  content: { fontSize: 16, lineHeight: 26 },
});
