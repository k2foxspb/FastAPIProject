import React, { useState, useCallback, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  Image, 
  TouchableOpacity, 
  Alert, 
  TextInput, 
  ScrollView, 
  Switch, 
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { usersApi } from '../api';
import { Ionicons as Icon } from '@expo/vector-icons';
import { getFullUrl } from '../utils/urlHelper';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function AlbumDetailScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { albumId, isOwner } = route.params;
  const [album, setAlbum] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState('public');
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [showComments, setShowComments] = useState(false);

  const fetchAlbum = useCallback(async () => {
    try {
      const res = await usersApi.getAlbum(albumId);
      setAlbum(res.data);
      setTitle(res.data.title);
      setDescription(res.data.description || '');
      setPrivacy(res.data.privacy || 'public');
      loadComments();
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить данные альбома');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [albumId, navigation]);

  const loadComments = async () => {
    try {
      const res = await usersApi.getAlbumComments(albumId);
      setComments(res.data);
    } catch (err) {
      console.error('Error loading comments:', err);
    }
  };

  const handleReaction = async (type) => {
    if (!album) return;
    try {
      const newReaction = album.my_reaction === type ? 0 : type;
      if (newReaction !== 0) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      await usersApi.reactToAlbum(albumId, newReaction);
      
      const updatedAlbum = { ...album };
      let likes = updatedAlbum.likes_count || 0;
      let dislikes = updatedAlbum.dislikes_count || 0;
      
      if (updatedAlbum.my_reaction === 1) likes--;
      if (updatedAlbum.my_reaction === -1) dislikes--;
      
      if (newReaction === 1) likes++;
      if (newReaction === -1) dislikes++;
      
      updatedAlbum.my_reaction = newReaction;
      updatedAlbum.likes_count = likes;
      updatedAlbum.dislikes_count = dislikes;
      setAlbum(updatedAlbum);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось отправить реакцию');
    }
  };

  const submitComment = async () => {
    if (!newComment.trim() || isSubmittingComment) return;
    try {
      setIsSubmittingComment(true);
      const res = await usersApi.addAlbumComment(albumId, newComment.trim());
      setComments(prev => [...prev, res.data]);
      setNewComment('');
      
      const updatedAlbum = { ...album };
      updatedAlbum.comments_count = (updatedAlbum.comments_count || 0) + 1;
      setAlbum(updatedAlbum);
    } catch (err) {
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
            await usersApi.deleteAlbumComment(commentId);
            setComments(comments.filter(c => c.id !== commentId));
            const updatedAlbum = { ...album };
            updatedAlbum.comments_count = Math.max(0, (updatedAlbum.comments_count || 0) - 1);
            setAlbum(updatedAlbum);
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
      if (newReaction !== 0) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await usersApi.reactToAlbumComment(commentId, newReaction);
      
      setComments(prev => prev.map(c => {
        if (c.id === commentId) {
          let likes = c.likes_count || 0;
          let dislikes = c.dislikes_count || 0;
          if (c.my_reaction === 1) likes--;
          if (c.my_reaction === -1) dislikes--;
          if (newReaction === 1) likes++;
          if (newReaction === -1) dislikes++;
          return { ...c, my_reaction: newReaction, likes_count: likes, dislikes_count: dislikes };
        }
        return c;
      }));
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось отправить реакцию');
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchAlbum();
    }, [fetchAlbum])
  );

  const handleUpdate = async () => {
    try {
      await usersApi.updateAlbum(albumId, { title, description, privacy });
      setIsEditing(false);
      fetchAlbum();
      Alert.alert('Успех', 'Альбом обновлен');
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось обновить альбом');
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Удаление альбома',
      'Вы уверены, что хотите удалить этот альбом? Все фотографии в нем также будут удалены.',
      [
        { text: 'Отмена', style: 'cancel' },
        { 
          text: 'Удалить', 
          style: 'destructive',
          onPress: async () => {
            try {
              await usersApi.deleteAlbum(albumId);
              navigation.goBack();
            } catch (err) {
              Alert.alert('Ошибка', 'Не удалось удалить альбом');
            }
          }
        }
      ]
    );
  };

  if (loading || !album) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Загрузка...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior="padding" 
      keyboardVerticalOffset={90}
      enabled={Platform.OS !== 'web'}
    >
      <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
        {isEditing ? (
          <View style={styles.editForm}>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              value={title}
              onChangeText={setTitle}
              placeholder="Название альбома"
              placeholderTextColor={colors.textSecondary}
            />
            <TextInput
              style={[styles.input, styles.textArea, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              value={description}
              onChangeText={setDescription}
              placeholder="Описание"
              placeholderTextColor={colors.textSecondary}
              multiline
            />
            <Text style={[styles.labelSmall, { color: colors.text, marginBottom: 10, fontWeight: 'bold' }]}>Кто может видеть альбом?</Text>
            <View style={styles.privacyContainer}>
              {[
                { label: 'Всем', value: 'public' },
                { label: 'Друзьям', value: 'friends' },
                { label: 'Только мне', value: 'private' },
              ].map((item) => (
                <TouchableOpacity
                  key={item.value}
                  style={[
                    styles.privacyOption,
                    { borderColor: colors.border },
                    privacy === item.value && { backgroundColor: colors.primary, borderColor: colors.primary }
                  ]}
                  onPress={() => setPrivacy(item.value)}
                >
                  <Text style={[
                    styles.privacyText,
                    { color: colors.text, fontSize: 12 },
                    privacy === item.value && { color: '#fff' }
                  ]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.buttonRow}>
              <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary }]} onPress={handleUpdate}>
                <Text style={styles.btnText}>Сохранить</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { backgroundColor: colors.textSecondary }]} onPress={() => setIsEditing(false)}>
                <Text style={styles.btnText}>Отмена</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: colors.text }]}>{album.title}</Text>
              {isOwner && (
                <View style={styles.actions}>
                  <TouchableOpacity onPress={() => setIsEditing(true)}>
                    <Icon name="create-outline" size={24} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleDelete} style={{ marginLeft: 15 }}>
                    <Icon name="trash-outline" size={24} color={colors.error} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
            {album.description ? <Text style={[styles.description, { color: colors.textSecondary }]}>{album.description}</Text> : null}
            <View style={styles.privateBadge}>
              <Icon 
                name={album.privacy === 'private' ? "lock-closed" : (album.privacy === 'friends' ? "people" : "globe-outline")} 
                size={14} 
                color={colors.textSecondary} 
              />
              <Text style={[styles.privateText, { color: colors.textSecondary }]}>
                {album.privacy === 'private' ? 'Только мне' : (album.privacy === 'friends' ? 'Друзьям' : 'Всем')}
              </Text>
            </View>
            <View style={styles.albumReactions}>
              <TouchableOpacity 
                style={[styles.reactionButton, album.my_reaction === 1 && { backgroundColor: colors.error + '20' }]} 
                onPress={() => handleReaction(1)}
              >
                <Icon name={album.my_reaction === 1 ? "heart" : "heart-outline"} size={22} color={album.my_reaction === 1 ? colors.error : colors.textSecondary} />
                <Text style={[styles.reactionText, { color: colors.textSecondary }]}>{album.likes_count || 0}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.reactionButton, { marginLeft: 15 }, album.my_reaction === -1 && { backgroundColor: colors.primary + '20' }]} 
                onPress={() => handleReaction(-1)}
              >
                <Icon name={album.my_reaction === -1 ? "thumbs-down" : "thumbs-down-outline"} size={22} color={album.my_reaction === -1 ? colors.primary : colors.textSecondary} />
                <Text style={[styles.reactionText, { color: colors.textSecondary }]}>{album.dislikes_count || 0}</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.reactionButton, { marginLeft: 15 }]} 
                onPress={() => setShowComments(!showComments)}
              >
                <Icon name="chatbubble-outline" size={20} color={colors.textSecondary} />
                <Text style={[styles.reactionText, { color: colors.textSecondary }]}>{album.comments_count || 0}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <View style={styles.photoGrid}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Фотографии ({album.photos?.length || 0})</Text>
        <View style={styles.grid}>
          {album.photos?.map(photo => {
            const isVideo = photo.image_url && ['mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm'].includes(photo.image_url.split('.').pop().toLowerCase());
            return (
              <TouchableOpacity 
                key={photo.id} 
                onPress={() => {
                  navigation.navigate('PhotoDetail', { 
                    photoId: photo.id,
                    initialPhotos: album.photos,
                    albumId: album.id,
                    isOwner: isOwner
                  });
                }}
                style={{ position: 'relative' }}
              >
                <Image source={{ uri: getFullUrl(photo.preview_url || photo.image_url) }} style={styles.photo} />
                {isVideo && (
                  <View style={styles.videoBadge}>
                    <Icon name="play" size={12} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
          {isOwner && (
            <TouchableOpacity 
              style={[styles.addPhotoBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => navigation.navigate('UploadPhoto', { albumId: album.id })}
              onLongPress={async () => {
                // Быстрая загрузка нескольких фото при долгом нажатии
                try {
                  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                  if (status !== 'granted') return;
                  
                  let result = await ImagePicker.launchImageLibraryAsync({
                    mediaTypes: ['images', 'videos'],
                    allowsMultipleSelection: true,
                    quality: 0.8,
                  });

                  if (!result.canceled && result.assets.length > 0) {
                    setLoading(true);
                    const formData = new FormData();
                    result.assets.forEach((asset, index) => {
                      const uri = asset.uri;
                      const isVideo = asset.type === 'video';
                      const defaultExt = isVideo ? 'mp4' : 'jpg';
                      const name = uri.split('/').pop() || `media_${index}.${defaultExt}`;
                      const match = /\.(\w+)$/.exec(name);
                      const ext = match ? match[1] : defaultExt;
                      const type = isVideo ? `video/${ext}` : `image/${ext}`;
                      
                      formData.append('files', {
                        uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
                        name,
                        type,
                      });
                    });
                    formData.append('album_id', albumId.toString());
                    formData.append('privacy', privacy);
                    
                    await usersApi.bulkUploadPhotos(formData);
                    fetchAlbum();
                    Alert.alert('Успех', `${result.assets.length} медиа загружено`);
                  }
                } catch (e) {
                  Alert.alert('Ошибка', 'Не удалось загрузить фото');
                } finally {
                  setLoading(false);
                }
              }}
            >
              <Icon name="add" size={40} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {showComments && (
        <View style={[styles.commentsSection, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text, paddingHorizontal: 0 }]}>Комментарии</Text>
          {comments.length === 0 ? (
            <Text style={[styles.emptyComments, { color: colors.textSecondary }]}>Нет комментариев</Text>
          ) : (
            comments.map(item => (
              <View key={item.id} style={styles.commentItem}>
                <Image 
                  source={{ uri: getFullUrl(item.avatar_url) || 'https://via.placeholder.com/30' }} 
                  style={styles.commentAvatar} 
                />
                <View style={styles.commentContent}>
                  <View style={styles.commentHeader}>
                    <Text style={[styles.commentUser, { color: colors.text }]}>
                      {item.first_name ? `${item.first_name} ${item.last_name || ''}` : `Пользователь #${item.user_id}`}
                    </Text>
                    {(isOwner || item.user_id === album.user_id) && (
                      <TouchableOpacity onPress={() => deleteComment(item.id)}>
                        <Icon name="trash-outline" size={14} color={colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <Text style={[styles.commentText, { color: colors.text }]}>{item.comment}</Text>
                  
                  <View style={styles.commentReactions}>
                    <TouchableOpacity 
                      onPress={() => handleCommentReaction(item.id, 1)}
                      style={styles.commentReactionButton}
                    >
                      <Icon 
                        name={item.my_reaction === 1 ? "heart" : "heart-outline"} 
                        size={14} 
                        color={item.my_reaction === 1 ? colors.error : colors.textSecondary} 
                      />
                      <Text style={[styles.commentReactionText, { color: colors.textSecondary }]}>{item.likes_count || 0}</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                      onPress={() => handleCommentReaction(item.id, -1)}
                      style={[styles.commentReactionButton, { marginLeft: 15 }]}
                    >
                      <Icon 
                        name={item.my_reaction === -1 ? "thumbs-down" : "thumbs-down-outline"} 
                        size={14} 
                        color={item.my_reaction === -1 ? colors.primary : colors.textSecondary} 
                      />
                      <Text style={[styles.commentReactionText, { color: colors.textSecondary }]}>{item.dislikes_count || 0}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>
      )}
    </ScrollView>
    {showComments && (
      <View style={[styles.commentInputContainer, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TextInput
          style={[styles.commentInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
          placeholder="Ваш комментарий..."
          placeholderTextColor={colors.textSecondary}
          value={newComment}
          onChangeText={setNewComment}
          multiline
        />
        <TouchableOpacity 
          onPress={submitComment} 
          disabled={!newComment.trim() || isSubmittingComment}
          style={styles.sendButton}
        >
          {isSubmittingComment ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Icon name="send" size={24} color={newComment.trim() ? colors.primary : colors.textSecondary} />
          )}
        </TouchableOpacity>
      </View>
    )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 20, borderBottomWidth: 1 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold' },
  actions: { flexDirection: 'row' },
  description: { fontSize: 16, marginTop: 10 },
  privateBadge: { flexDirection: 'row', alignItems: 'center', marginTop: 5 },
  privateText: { fontSize: 14, marginLeft: 4 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, paddingHorizontal: 20, marginTop: 20 },
  editForm: { width: '100%' },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 16 },
  textArea: { height: 80, textAlignVertical: 'top' },
  buttonRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  btn: { padding: 10, borderRadius: 8, marginLeft: 10, minWidth: 80, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold' },
  privacyContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  privacyOption: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  privacyText: {
    fontSize: 14,
    fontWeight: '500',
  },
  photoGrid: { paddingBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 15 },
  photo: { width: 110, height: 110, margin: 5, borderRadius: 8 },
  addPhotoBtn: { 
    width: 110, 
    height: 110, 
    margin: 5, 
    borderRadius: 8, 
    borderWidth: 1, 
    borderStyle: 'dashed', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  videoBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 10,
    padding: 2,
  },
  albumReactions: { 
    flexDirection: 'row', 
    marginTop: 15, 
    alignItems: 'center' 
  },
  reactionButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 8, 
    borderRadius: 12, 
    backgroundColor: 'rgba(0,0,0,0.05)' 
  },
  reactionText: { 
    marginLeft: 6, 
    fontWeight: 'bold', 
    fontSize: 14 
  },
  commentsSection: { 
    padding: 20, 
    borderTopWidth: 1, 
    paddingBottom: 40 
  },
  commentItem: { 
    flexDirection: 'row', 
    marginBottom: 15 
  },
  commentAvatar: { 
    width: 32, 
    height: 32, 
    borderRadius: 16, 
    marginRight: 10 
  },
  commentContent: { 
    flex: 1 
  },
  commentHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  commentUser: { 
    fontSize: 14, 
    fontWeight: 'bold' 
  },
  commentText: { 
    fontSize: 15, 
    marginTop: 2, 
    lineHeight: 20 
  },
  commentReactions: { 
    flexDirection: 'row', 
    marginTop: 6 
  },
  commentReactionButton: { 
    flexDirection: 'row', 
    alignItems: 'center' 
  },
  commentReactionText: { 
    fontSize: 12, 
    marginLeft: 4 
  },
  emptyComments: { 
    textAlign: 'center', 
    marginVertical: 20, 
    fontSize: 14 
  },
  commentInputContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  commentInput: { 
    flex: 1, 
    paddingHorizontal: 15,
    paddingVertical: 8, 
    maxHeight: 100,
    borderRadius: 20,
    borderWidth: 1,
  },
  sendButton: { 
    padding: 5, 
    marginLeft: 5 
  },
});
