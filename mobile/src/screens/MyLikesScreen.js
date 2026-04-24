import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator, Dimensions } from 'react-native';
import { getShadow } from '../utils/shadowStyles';
import FadeInImage from '../components/FadeInImage';
import { usersApi } from '../api';
import { getFullUrl } from '../utils/urlHelper';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { Ionicons as Icon } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

export default function MyLikesScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [activeTab, setActiveTab] = useState('news'); // 'news' or 'photos'
  const [news, setNews] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      setLoading(true);
      const [newsRes, photosRes] = await Promise.all([
        usersApi.getLikedNews().catch(() => ({ data: [] })),
        usersApi.getLikedPhotos().catch(() => ({ data: [] }))
      ]);
      setNews(newsRes.data);
      setPhotos(photosRes.data);
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
            </View>
            <Text style={[styles.newsContent, { color: colors.textSecondary }]} numberOfLines={2}>
              {stripHtml(item.content)}
            </Text>
            <View style={styles.newsFooter}>
              <Text style={[styles.newsDate, { color: colors.textSecondary }]}>{new Date(item.created_at).toLocaleDateString()}</Text>
              <View style={styles.reactionsRow}>
                <View style={styles.reactionItem}>
                  <Icon name="heart" size={14} color={colors.error} />
                  <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>{item.likes_count || 0}</Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderPhotoItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.photoContainer}
      onPress={() => navigation.navigate('PhotoDetail', { 
        photoId: item.id, 
        initialPhotos: photos 
      })}
    >
      <FadeInImage 
        source={{ uri: getFullUrl(item.preview_url || item.image_url) }} 
        style={styles.photo} 
      />
      <View style={styles.photoOverlay}>
        <Icon name="heart" size={12} color="#fff" />
        <Text style={styles.photoLikes}>{item.likes_count || 0}</Text>
      </View>
    </TouchableOpacity>
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
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'news' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]} 
          onPress={() => setActiveTab('news')}
        >
          <Text style={[styles.tabText, { color: activeTab === 'news' ? colors.primary : colors.textSecondary }]}>Новости</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'photos' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]} 
          onPress={() => setActiveTab('photos')}
        >
          <Text style={[styles.tabText, { color: activeTab === 'photos' ? colors.primary : colors.textSecondary }]}>Фотографии</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={activeTab === 'news' ? news : photos}
        keyExtractor={(item) => item.id.toString()}
        renderItem={activeTab === 'news' ? renderNewsItem : renderPhotoItem}
        contentContainerStyle={styles.listContent}
        numColumns={activeTab === 'news' ? 1 : 3}
        key={activeTab} // Force re-render to change numColumns
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="heart-dislike-outline" size={60} color={colors.textSecondary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {activeTab === 'news' 
                ? 'Вы еще не лайкнули ни одной новости' 
                : 'Вы еще не лайкнули ни одной фотографии'}
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
  tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, paddingVertical: 15, alignItems: 'center' },
  tabText: { fontSize: 16, fontWeight: 'bold' },
  listContent: { padding: 5 },
  newsCard: { borderRadius: 12, marginBottom: 12, marginHorizontal: 5, overflow: 'hidden', ...getShadow('#000', { width: 0, height: 2 }, 0.1, 4, 3) },
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
  photoContainer: {
    width: (width - 30) / 3,
    height: (width - 30) / 3,
    margin: 5,
    borderRadius: 8,
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoOverlay: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  photoLikes: {
    color: '#fff',
    fontSize: 10,
    marginLeft: 2,
  },
  emptyContainer: { alignItems: 'center', marginTop: 100 },
  emptyText: { textAlign: 'center', marginTop: 20, fontSize: 16, paddingHorizontal: 40 },
});
