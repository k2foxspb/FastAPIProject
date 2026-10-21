import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Image, ScrollView, Dimensions, ActivityIndicator, Alert, TouchableOpacity, TextInput, Platform, RefreshControl } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RenderHTML from 'react-native-render-html';
import { announcementsApi } from '../api';
import { getFullUrl } from '../utils/formatters';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useNotifications } from '../context/NotificationContext';
import { getRoleLabel } from '../constants/roles';

const { width } = Dimensions.get('window');

const getPriorityInfo = (priority) => {
  if (priority === 'urgent') return { label: 'Срочно', color: '#e53935' };
  if (priority === 'important') return { label: 'Важно', color: '#fb8c00' };
  return { label: 'Обычное', color: '#1e88e5' };
};

export default function AnnouncementDetailScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { announcementId, announcementItem: initialAnnouncement } = route.params;
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser } = useNotifications();

  const [announcement, setAnnouncement] = useState(initialAnnouncement || null);
  const [loading, setLoading] = useState(!initialAnnouncement);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadAnnouncement();
    loadComments();
    markRead();
  }, [announcementId]);

  const markRead = async () => {
    try {
      await announcementsApi.markAsRead(announcementId);
    } catch (err) {
      // Автор или уже прочитано — игнорируем ошибку
    }
  };

  const loadAnnouncement = async () => {
    try {
      setLoading(true);
      const res = await announcementsApi.getAnnouncementDetail(announcementId);
      setAnnouncement(res.data);
    } catch (err) {
      console.error(err);
      Alert.alert('Ошибка', 'Не удалось загрузить объявление');
    } finally {
      setLoading(false);
    }
  };

  const loadComments = async () => {
    try {
      const res = await announcementsApi.getAnnouncementComments(announcementId);
      setComments(res.data || []);
    } catch (err) {
      console.error('Error loading comments:', err);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadAnnouncement(), loadComments()]);
    setRefreshing(false);
  }, [announcementId]);

  const submitComment = async () => {
    if (!newComment.trim() || isSubmittingComment) return;

    try {
      setIsSubmittingComment(true);
      const res = await announcementsApi.addAnnouncementComment(announcementId, newComment.trim());
      setComments((prev) => [...prev, res.data]);
      setNewComment('');

      setAnnouncement((prev) => ({
        ...prev,
        comments_count: (prev?.comments_count || 0) + 1,
      }));
    } catch (err) {
      console.error(err);
      Alert.alert('Ошибка', 'Не удалось добавить комментарий');
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
            await announcementsApi.deleteAnnouncementComment(commentId);
            setComments((prev) => prev.filter((c) => c.id !== commentId));

            setAnnouncement((prev) => ({
              ...prev,
              comments_count: Math.max(0, (prev?.comments_count || 0) - 1),
            }));
          } catch (err) {
            Alert.alert('Ошибка', 'Не удалось удалить комментарий');
          }
        },
      },
    ]);
  };

  if (loading || !announcement) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const authorName = announcement.author
    ? `${announcement.author.first_name || ''} ${announcement.author.last_name || ''}`.trim() || 'Пользователь'
    : 'Пользователь';
  const authorRole = announcement.author ? getRoleLabel(announcement.author.role) : '';
  const priorityInfo = getPriorityInfo(announcement.priority);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior="padding"
      keyboardVerticalOffset={90}
    >
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.contentContainer}>
          <View style={styles.authorContainer}>
            <Image
              source={{ uri: getFullUrl(announcement.author?.avatar_url) || 'https://via.placeholder.com/40' }}
              style={styles.authorAvatar}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.authorName, { color: colors.text }]}>{authorName}</Text>
              <Text style={[styles.authorRoleText, { color: colors.textSecondary }]}>
                {authorRole} {announcement.workshop_name ? `• ${announcement.workshop_name}` : ''}
              </Text>
            </View>
            <View style={[styles.priorityBadge, { backgroundColor: priorityInfo.color + '20' }]}>
              <Text style={[styles.priorityText, { color: priorityInfo.color }]}>{priorityInfo.label}</Text>
            </View>
          </View>

          <Text style={[styles.title, { color: colors.text }]}>{announcement.title}</Text>
          <Text style={[styles.date, { color: colors.textSecondary }]}>
            {new Date(announcement.created_at).toLocaleDateString()} {new Date(announcement.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <RenderHTML
            contentWidth={width - 40}
            source={{ html: announcement.content || '' }}
            tagsStyles={{
              body: { color: colors.text, fontSize: 16, lineHeight: 24 },
              p: { marginBottom: 10 },
              img: { borderRadius: 8, marginVertical: 10, maxWidth: '100%' },
            }}
          />

          <View style={[styles.divider, { backgroundColor: colors.border, marginTop: 30 }]} />
          <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 20 }]}>
            Комментарии ({announcement.comments_count || 0})
          </Text>

          {comments.map((item) => {
            const isMyComment = currentUser && (currentUser.id === item.user_id || currentUser.role === 'admin' || currentUser.role === 'owner');
            return (
              <View key={item.id} style={styles.commentCard}>
                <View style={styles.commentHeader}>
                  <View style={styles.commentUserContainer}>
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
                  </View>
                  {isMyComment && (
                    <TouchableOpacity onPress={() => deleteComment(item.id)}>
                      <Icon name="trash-outline" size={18} color={colors.error} />
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={[styles.commentText, { color: colors.text }]}>{item.comment}</Text>
              </View>
            );
          })}

          {comments.length === 0 && (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Пока нет комментариев. Будьте первым!</Text>
          )}

          <View style={{ height: 40 }} />
        </View>
      </ScrollView>

      <View style={[styles.stickyAddCommentContainer, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TextInput
          style={[styles.commentInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  contentContainer: { padding: 20 },
  authorContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  authorAvatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  authorName: { fontSize: 16, fontWeight: 'bold' },
  authorRoleText: { fontSize: 12, marginTop: 2 },
  priorityBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  priorityText: { fontSize: 12, fontWeight: 'bold' },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 6 },
  date: { fontSize: 13, marginBottom: 15 },
  divider: { height: 1, width: '100%', marginBottom: 20 },
  sectionTitle: { fontSize: 20, fontWeight: 'bold' },
  commentCard: { marginBottom: 20, paddingBottom: 15, borderBottomWidth: 0.5, borderBottomColor: '#ccc' },
  commentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  commentUserContainer: { flexDirection: 'row', alignItems: 'center' },
  commentAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
  commentUser: { fontWeight: 'bold', fontSize: 14 },
  commentDate: { fontSize: 11 },
  commentText: { fontSize: 15, lineHeight: 20 },
  emptyText: { textAlign: 'center', marginTop: 10 },
  stickyAddCommentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderTopWidth: 1,
  },
  commentInput: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 8,
    marginRight: 10,
    maxHeight: 100,
    borderWidth: 1,
  },
  submitButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
