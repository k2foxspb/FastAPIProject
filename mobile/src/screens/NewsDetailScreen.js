import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image, ScrollView, Dimensions, ActivityIndicator, Alert, FlatList, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import RenderHTML from 'react-native-render-html';
import { newsApi, usersApi } from '../api';
import { getFullUrl } from '../utils/urlHelper';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useNotifications } from '../context/NotificationContext';

const { width } = Dimensions.get('window');

export default function NewsDetailScreen({ route, navigation }) {
  const { newsId, newsItem: initialNewsItem } = route.params;
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser } = useNotifications();
  
  const [news, setNews] = useState(initialNewsItem || null);
  const [loading, setLoading] = useState(!initialNewsItem);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [user, setUser] = useState(currentUser);

  useEffect(() => {
    loadNews();
    loadComments();
    if (!currentUser) {
      fetchUser();
    } else {
      setUser(currentUser);
    }
  }, [currentUser]);

  const fetchUser = async () => {
    try {
      const res = await usersApi.getMe();
      setUser(res.data);
    } catch (err) {
      console.log('Not logged in or error fetching user');
    }
  };

  const loadComments = async () => {
    try {
      const res = await newsApi.getNewsComments(newsId);
      setComments(res.data);
    } catch (err) {
      console.error('Error loading comments:', err);
    }
  };

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

  const submitComment = async () => {
    if (!newComment.trim() || isSubmittingComment) return;
    
    try {
      setIsSubmittingComment(true);
      const res = await newsApi.addNewsComment(newsId, newComment.trim());
      setComments(prev => [...prev, res.data]);
      setNewComment('');
      
      // Обновляем счетчик в новости
      setNews(prev => ({
        ...prev,
        comments_count: (prev.comments_count || 0) + 1
      }));
    } catch (err) {
      console.error(err);
      if (err.response?.status === 401) {
        Alert.alert('Авторизация', 'Войдите в аккаунт, чтобы оставлять комментарии');
      } else {
        Alert.alert('Ошибка', 'Не удалось добавить комментарий');
      }
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const deleteComment = (commentId) => {
    Alert.alert('Удаление', 'Вы уверены, что хотите удалить комментарий?', [
      { text: 'Отмена', style: 'cancel' },
      { 
        text: 'Удалить', 
        style: 'destructive',
        onPress: async () => {
          try {
            await newsApi.deleteNewsComment(commentId);
            setComments(comments.filter(c => c.id !== commentId));
            
            setNews(prev => ({
              ...prev,
              comments_count: Math.max(0, (prev.comments_count || 0) - 1)
            }));
          } catch (err) {
            Alert.alert('Ошибка', 'Не удалось удалить комментарий');
          }
        }
      }
    ]);
  };

  const handleCommentReaction = async (commentId, type) => {
    try {
      const comment = comments.find(c => c.id === commentId);
      if (!comment) return;

      const newReaction = comment.my_reaction === type ? 0 : type;
      await newsApi.reactToNewsComment(commentId, newReaction);
      
      setComments(prev => prev.map(c => {
        if (c.id === commentId) {
          let likes = c.likes_count || 0;
          let dislikes = c.dislikes_count || 0;
          
          if (c.my_reaction === 1) likes--;
          if (c.my_reaction === -1) dislikes--;
          
          if (newReaction === 1) likes++;
          if (newReaction === -1) dislikes++;
          
          return {
            ...c,
            my_reaction: newReaction,
            likes_count: likes,
            dislikes_count: dislikes
          };
        }
        return c;
      }));
    } catch (err) {
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
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
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
          <TouchableOpacity 
            style={styles.newsAuthorContainer}
            onPress={() => navigation.navigate('UserProfile', { userId: news.author_id })}
          >
            <Image 
              source={{ uri: getFullUrl(news.author_avatar_url) || 'https://via.placeholder.com/40' }} 
              style={styles.newsAuthorAvatar} 
            />
            <View>
              <Text style={[styles.newsAuthorName, { color: colors.text }]}>
                {news.author_first_name ? `${news.author_first_name} ${news.author_last_name || ''}` : 'Пользователь'}
              </Text>
              <Text style={[styles.date, { color: colors.textSecondary }]}>
                {new Date(news.created_at).toLocaleDateString()} {new Date(news.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          </TouchableOpacity>

          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.text }]}>{news.title}</Text>
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

          <View style={[styles.divider, { backgroundColor: colors.border, marginTop: 30 }]} />
          <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 20 }]}>
            Комментарии ({news.comments_count || 0})
          </Text>

          {comments.map((item) => {
            const isMyComment = user && (user.id === item.user_id || user.role === 'admin' || user.role === 'owner');
            return (
              <View key={item.id} style={styles.commentCard}>
                <View style={styles.commentHeader}>
                  <TouchableOpacity 
                    onPress={() => navigation.navigate('UserProfile', { userId: item.user_id })}
                    style={styles.commentUserContainer}
                  >
                    <Image 
                      source={{ uri: getFullUrl(item.avatar_url) || 'https://via.placeholder.com/40' }} 
                      style={styles.commentAvatar} 
                    />
                    <View>
                      <Text style={[styles.commentUser, { color: colors.text }]}>
                        {item.first_name ? `${item.first_name} ${item.last_name || ''}` : `Пользователь #${item.user_id}`}
                      </Text>
                      <Text style={[styles.commentDate, { color: colors.textSecondary }]}>
                        {new Date(item.created_at).toLocaleDateString()} {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  {isMyComment && (
                    <TouchableOpacity onPress={() => deleteComment(item.id)}>
                      <Icon name="trash-outline" size={18} color={colors.error} />
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={[styles.commentText, { color: colors.text }]}>{item.comment}</Text>
                
                <View style={styles.commentFooter}>
                  <View style={styles.commentReactions}>
                    <TouchableOpacity 
                      onPress={() => handleCommentReaction(item.id, 1)}
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
                      onPress={() => handleCommentReaction(item.id, -1)}
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
          })}

          {comments.length === 0 && (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Пока нет комментариев. Будьте первым!</Text>
          )}

          {user ? (
            <View style={[styles.addCommentContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TextInput
                style={[styles.commentInput, { color: colors.text, borderColor: colors.border }]}
                placeholder="Ваш комментарий..."
                placeholderTextColor={colors.textSecondary}
                multiline
                value={newComment}
                onChangeText={setNewComment}
              />
              <TouchableOpacity 
                style={[styles.submitButton, { backgroundColor: colors.primary }]}
                onPress={submitComment}
                disabled={isSubmittingComment || !newComment.trim()}
              >
                {isSubmittingComment ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Icon name="send" size={20} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity 
              style={[styles.loginPrompt, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => navigation.navigate('Profile')}
            >
              <Text style={{ color: colors.primary, fontWeight: 'bold' }}>Войдите, чтобы оставить комментарий</Text>
            </TouchableOpacity>
          )}
          <View style={{ height: 40 }} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
  newsAuthorContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  newsAuthorAvatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  newsAuthorName: { fontSize: 16, fontWeight: 'bold' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 10 },
  date: { fontSize: 14, marginBottom: 15 },
  divider: { height: 1, width: '100%', marginBottom: 20 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  reactionsContainer: { flexDirection: 'row', alignItems: 'center' },
  reactionButton: { flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 12, borderWidth: 1, borderColor: 'transparent' },
  reactionText: { marginLeft: 6, fontWeight: 'bold', fontSize: 16 },
  sectionTitle: { fontSize: 20, fontWeight: 'bold' },
  commentCard: { marginBottom: 20, paddingBottom: 15, borderBottomWidth: 0.5, borderBottomColor: '#ccc' },
  commentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  commentUserContainer: { flexDirection: 'row', alignItems: 'center' },
  commentAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
  commentUser: { fontWeight: 'bold', fontSize: 14 },
  commentDate: { fontSize: 11 },
  commentText: { fontSize: 15, lineHeight: 20, marginBottom: 8 },
  commentFooter: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  commentReactions: { flexDirection: 'row', alignItems: 'center' },
  commentReactionButton: { flexDirection: 'row', alignItems: 'center' },
  commentReactionText: { marginLeft: 4, fontSize: 12 },
  addCommentContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 20, padding: 10, borderRadius: 12, borderWidth: 1 },
  commentInput: { flex: 1, minHeight: 40, maxHeight: 100, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 },
  submitButton: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginLeft: 10 },
  emptyText: { textAlign: 'center', marginVertical: 20, fontSize: 14, fontStyle: 'italic' },
  loginPrompt: { padding: 15, borderRadius: 12, borderWidth: 1, alignItems: 'center', marginTop: 20 },
});
