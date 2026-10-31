import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  Dimensions,
  Platform,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useHeaderHeight } from '@react-navigation/elements';
import RenderHTML from 'react-native-render-html';
import { useFocusEffect } from '@react-navigation/native';
import { usersApi } from '../api';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useNotifications } from '../context/NotificationContext';
import { theme as themeConstants } from '../constants/theme';
import { getFullUrl, getAvatarUrl, formatName, formatPostDateTime } from '../utils/formatters';
import FadeInImage from '../components/FadeInImage';
import VideoPlayer from '../components/VideoPlayer';

// Полноценный экран публикации (пост или объявление) из ленты: показывает текст и
// медиафайл целиком (без обрезки), а не только модалку с комментариями, плюс список
// комментариев и поле для добавления нового - переиспользует те же API-методы, что и
// комментарии к публикациям профиля (эндпоинты одинаковы для post и announcement,
// так как оба типа хранятся как ProfilePost).
export default function PostDetailScreen({ route, navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser } = useNotifications();
  // Реальная высота нативного заголовка экрана (вместе с safe area) - без неё
  // keyboardVerticalOffset с фиксированным числом не угадывает высоту заголовка на
  // разных устройствах, из-за чего поле ввода комментария не прилипало к клавиатуре.
  const headerHeight = useHeaderHeight();
  const initialItem = route.params?.item;

  const [post, setPost] = useState(initialItem);
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const isAnnouncement = post?.item_type === 'announcement';

  const loadComments = useCallback(async () => {
    if (!post?.id) return;
    setLoadingComments(true);
    try {
      const res = await usersApi.getProfilePostComments(post.id);
      setComments(res.data || []);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить комментарии');
    } finally {
      setLoadingComments(false);
    }
  }, [post?.id]);

  useFocusEffect(
    useCallback(() => {
      navigation.setOptions({ title: isAnnouncement ? 'Объявление' : 'Публикация' });
      loadComments();
    }, [loadComments, navigation, isAnnouncement])
  );

  const handleReact = async () => {
    try {
      const res = await usersApi.reactToProfilePost(post.id, 'like');
      const action = res.data?.action;
      setPost(prev => {
        const currentCount = prev.likes_count || prev.reactions_count || 0;
        if (action === 'added') {
          return { ...prev, my_reaction: 'like', likes_count: currentCount + 1, reactions_count: currentCount + 1 };
        } else if (action === 'removed') {
          return { ...prev, my_reaction: null, likes_count: Math.max(0, currentCount - 1), reactions_count: Math.max(0, currentCount - 1) };
        }
        return prev;
      });
    } catch (err) {
      console.log('React error:', err);
    }
  };

  const handleAddComment = async () => {
    if (!newCommentText.trim() || !post?.id) return;
    setSubmittingComment(true);
    try {
      const res = await usersApi.addProfilePostComment(post.id, newCommentText.trim());
      setComments(prev => [...prev, res.data]);
      setNewCommentText('');
      setPost(prev => ({ ...prev, comments_count: (prev.comments_count || 0) + 1 }));
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось отправить комментарий');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    try {
      await usersApi.deleteProfilePostComment(commentId);
      setComments(prev => prev.filter(c => c.id !== commentId));
      setPost(prev => ({ ...prev, comments_count: Math.max(0, (prev.comments_count || 1) - 1) }));
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось удалить комментарий');
    }
  };

  if (!post) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Публикация не найдена</Text>
      </View>
    );
  }

  const authorName = post.author
    ? formatName(post.author)
    : (post.author_first_name ? `${post.author_first_name} ${post.author_last_name || ''}`.trim() : 'Пользователь');
  const authorAvatar = post.author?.avatar_url || post.author_avatar_url;
  const hasMedia = !!post.media_url;
  const isVideoMedia = hasMedia && (
    post.media_type === 'video' ||
    (post.media_type !== 'image' && ['mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm'].includes((post.media_url.split('.').pop() || '').toLowerCase()))
  );
  const likesCount = post.likes_count ?? post.reactions_count ?? 0;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.authorHeader}>
          <TouchableOpacity
            style={styles.authorInfo}
            onPress={() => navigation.navigate('UserProfile', { userId: post.author_id || post.author?.id })}
          >
            <Image
              source={{ uri: getAvatarUrl(authorAvatar) }}
              style={styles.authorAvatar}
            />
            <View>
              <Text style={[styles.authorName, { color: colors.text }]}>{authorName}</Text>
              <Text style={[styles.postDate, { color: colors.textSecondary }]}>
                {formatPostDateTime(post.created_at)}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {!!post.content && (
          post.content.includes('<') && post.content.includes('>') ? (
            <View style={{ paddingHorizontal: 12 }}>
              <RenderHTML
                contentWidth={Dimensions.get('window').width - 24}
                source={{ html: post.content }}
                tagsStyles={{
                  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
                  p: { marginBottom: 8 },
                  img: { borderRadius: 8, marginVertical: 8, maxWidth: '100%' },
                }}
              />
            </View>
          ) : (
            <Text style={{ fontSize: 15, lineHeight: 22, color: colors.text, paddingHorizontal: 12, paddingVertical: 8 }}>
              {post.content}
            </Text>
          )
        )}

        {hasMedia && (
          isVideoMedia ? (
            <VideoPlayer
              uri={getFullUrl(post.media_url)}
              style={{ width: '100%', height: 260, marginVertical: 6 }}
              useNativeControls
              shouldPlay={false}
              resizeMode="contain"
            />
          ) : (
            <FadeInImage
              source={{ uri: getFullUrl(post.media_url) }}
              style={{ width: '100%', height: 300, marginVertical: 6 }}
              resizeMode="contain"
            />
          )
        )}

        <View style={[styles.reactionsRow, { borderColor: colors.border }]}>
          <TouchableOpacity style={styles.reactionItem} onPress={handleReact}>
            <Icon
              name={post.my_reaction ? 'heart' : 'heart-outline'}
              size={20}
              color={post.my_reaction ? (colors.error || '#e53935') : colors.textSecondary}
            />
            <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>{likesCount}</Text>
          </TouchableOpacity>
          <View style={[styles.reactionItem, { marginLeft: 20 }]}>
            <Icon name="chatbubble-outline" size={18} color={colors.textSecondary} />
            <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>{post.comments_count || 0}</Text>
          </View>
        </View>

        <View style={[styles.commentsSection, { borderTopColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Комментарии</Text>

          {loadingComments ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ margin: 20 }} />
          ) : comments.length === 0 ? (
            <Text style={[styles.emptyCommentsText, { color: colors.textSecondary }]}>Пока нет комментариев</Text>
          ) : (
            comments.map((c) => {
              const cAuthorName = c.user
                ? `${c.user.first_name || ''} ${c.user.last_name || ''}`.trim() || 'Пользователь'
                : 'Пользователь';
              const canDelete =
                currentUser &&
                (currentUser.id === c.user_id ||
                  currentUser.id === (post.author_id || post.author?.id) ||
                  ['admin', 'owner'].includes(currentUser.role));

              return (
                <View key={c.id} style={[styles.commentItem, { borderBottomColor: colors.border }]}>
                  <Image
                    source={{ uri: getAvatarUrl(c.user?.avatar_url || c.avatar_url) }}
                    style={styles.commentAvatar}
                  />
                  <View style={{ flex: 1 }}>
                    <View style={styles.commentHeaderRow}>
                      <Text style={[styles.commentAuthorName, { color: colors.text }]}>{cAuthorName}</Text>
                      {canDelete && (
                        <TouchableOpacity onPress={() => handleDeleteComment(c.id)}>
                          <Icon name="trash-outline" size={14} color={colors.error || '#e53935'} />
                        </TouchableOpacity>
                      )}
                    </View>
                    <Text style={[styles.commentText, { color: colors.text }]}>{c.comment}</Text>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <View style={[styles.commentInputRow, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TextInput
          style={[styles.commentInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          placeholder="Написать комментарий..."
          placeholderTextColor={colors.textSecondary}
          value={newCommentText}
          onChangeText={setNewCommentText}
        />
        <TouchableOpacity
          style={[styles.sendCommentBtn, { backgroundColor: colors.primary }]}
          onPress={handleAddComment}
          disabled={submittingComment}
        >
          {submittingComment ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Icon name="send" size={16} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  authorHeader: { padding: 12 },
  authorInfo: { flexDirection: 'row', alignItems: 'center' },
  authorAvatar: { width: 44, height: 44, borderRadius: 22, marginRight: 10 },
  authorName: { fontSize: 15, fontWeight: 'bold' },
  postDate: { fontSize: 12, marginTop: 2 },
  reactionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  reactionItem: { flexDirection: 'row', alignItems: 'center' },
  reactionCount: { fontSize: 13, marginLeft: 5 },
  commentsSection: { padding: 12 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  emptyCommentsText: { fontSize: 13, textAlign: 'center', marginVertical: 20 },
  commentItem: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 0.5 },
  commentAvatar: { width: 32, height: 32, borderRadius: 16, marginRight: 10 },
  commentHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  commentAuthorName: { fontSize: 13, fontWeight: 'bold' },
  commentText: { fontSize: 13, marginTop: 2 },
  commentInputRow: { flexDirection: 'row', alignItems: 'center', padding: 10, borderTopWidth: 1 },
  commentInput: { flex: 1, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8 },
  sendCommentBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
});
