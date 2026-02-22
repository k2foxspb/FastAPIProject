import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Image, 
  TouchableOpacity, 
  Alert, 
  ScrollView, 
  Dimensions, 
  FlatList,
  ActivityIndicator,
  StatusBar,
  TextInput,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { usersApi } from '../api';
import { Ionicons as Icon } from '@expo/vector-icons';
import { getFullUrl } from '../utils/urlHelper';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

const { width, height } = Dimensions.get('window');

export default function PhotoDetailScreen({ route, navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { photoId, initialPhotos, albumId, isOwner } = route.params;
  const [photos, setPhotos] = useState(initialPhotos || []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showDescription, setShowDescription] = useState(false);
  const [loading, setLoading] = useState(!initialPhotos);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const flatListRef = useRef(null);

  const fetchAlbumPhotos = useCallback(async () => {
    try {
      setLoading(true);
      
      let photoData = [];
      if (initialPhotos) {
        photoData = [...initialPhotos];
      } else {
        const photoRes = await usersApi.getPhoto(photoId);
        const targetAlbumId = photoRes.data.album_id;
        
        if (targetAlbumId) {
          const albumRes = await usersApi.getAlbum(targetAlbumId);
          photoData = albumRes.data.photos || [];
        } else {
          photoData = [photoRes.data];
        }
      }

      // Fetch full details for the current photo (with reactions and counts)
      const currentPhotoId = initialPhotos ? photoId : (photoData[0]?.id || photoId);
      const detailedPhotoRes = await usersApi.getPhoto(currentPhotoId);
      
      const updatedPhotos = photoData.map(p => 
        p.id === currentPhotoId ? detailedPhotoRes.data : p
      );
      
      setPhotos(updatedPhotos);
      const idx = updatedPhotos.findIndex(p => p.id === currentPhotoId);
      if (idx !== -1) setCurrentIndex(idx);
      
      // Initial load of comments
      loadComments(currentPhotoId);
    } catch (err) {
      console.error('Error fetching photos:', err);
      Alert.alert('Ошибка', 'Не удалось загрузить фотографии');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [photoId, initialPhotos, navigation]);

  const loadComments = async (id) => {
    try {
      const res = await usersApi.getPhotoComments(id);
      setComments(res.data);
    } catch (err) {
      console.error('Error loading comments:', err);
    }
  };

  const handleReaction = async (type) => {
    const currentPhoto = photos[currentIndex];
    if (!currentPhoto) return;

    try {
      const newReaction = currentPhoto.my_reaction === type ? 0 : type;
      await usersApi.reactToPhoto(currentPhoto.id, newReaction);
      
      // Update local state
      const updatedPhotos = [...photos];
      const p = { ...updatedPhotos[currentIndex] };
      
      let likes = p.likes_count || 0;
      let dislikes = p.dislikes_count || 0;
      
      if (p.my_reaction === 1) likes--;
      if (p.my_reaction === -1) dislikes--;
      
      if (newReaction === 1) likes++;
      if (newReaction === -1) dislikes++;
      
      p.my_reaction = newReaction;
      p.likes_count = likes;
      p.dislikes_count = dislikes;
      
      updatedPhotos[currentIndex] = p;
      setPhotos(updatedPhotos);
    } catch (err) {
      console.error(err);
      Alert.alert('Ошибка', 'Не удалось отправить реакцию');
    }
  };

  const submitComment = async () => {
    if (!newComment.trim() || isSubmittingComment) return;
    
    const currentPhoto = photos[currentIndex];
    try {
      setIsSubmittingComment(true);
      const res = await usersApi.addPhotoComment(currentPhoto.id, newComment.trim());
      setComments(prev => [...prev, res.data]);
      setNewComment('');
      
      // Update comments count
      const updatedPhotos = [...photos];
      updatedPhotos[currentIndex].comments_count = (updatedPhotos[currentIndex].comments_count || 0) + 1;
      setPhotos(updatedPhotos);
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
            await usersApi.deletePhotoComment(commentId);
            setComments(comments.filter(c => c.id !== commentId));
            
            const updatedPhotos = [...photos];
            updatedPhotos[currentIndex].comments_count = Math.max(0, (updatedPhotos[currentIndex].comments_count || 0) - 1);
            setPhotos(updatedPhotos);
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
      await usersApi.reactToPhotoComment(commentId, newReaction);
      
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
      Alert.alert('Ошибка', 'Не удалось отправить реакцию');
    }
  };

  useEffect(() => {
    fetchAlbumPhotos();
  }, [fetchAlbumPhotos]);

  const toggleDescription = () => {
    if (selectionMode) return;
    setShowDescription(!showDescription);
  };

  const toggleSelection = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const enterSelectionMode = () => {
    setSelectionMode(true);
    setShowDescription(false);
    setSelectedIds([photos[currentIndex].id]);
  };

  const deletePhotos = async () => {
    const idsToDelete = selectionMode ? selectedIds : [photos[currentIndex].id];
    
    Alert.alert(
      'Удаление',
      `Вы уверены, что хотите удалить ${idsToDelete.length} фото?`,
      [
        { text: 'Отмена', style: 'cancel' },
        { 
          text: 'Удалить', 
          style: 'destructive',
          onPress: async () => {
            try {
              if (idsToDelete.length === 1) {
                await usersApi.deletePhoto(idsToDelete[0]);
              } else {
                await usersApi.bulkDeletePhotos(idsToDelete);
              }
              
              const remainingPhotos = photos.filter(p => !idsToDelete.includes(p.id));
              if (remainingPhotos.length === 0) {
                navigation.goBack();
              } else {
                setPhotos(remainingPhotos);
                setSelectionMode(false);
                setSelectedIds([]);
                // Adjust currentIndex if necessary
                if (currentIndex >= remainingPhotos.length) {
                  setCurrentIndex(remainingPhotos.length - 1);
                }
              }
            } catch (err) {
              console.error(err);
              Alert.alert('Ошибка', 'Не удалось удалить фотографии');
            }
          }
        }
      ]
    );
  };

  const isVideo = (url) => {
    if (!url) return false;
    const ext = url.split('.').pop().toLowerCase();
    return ['mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm'].includes(ext);
  };

  const renderItem = ({ item, index }) => {
    const isSelected = selectedIds.includes(item.id);
    const mediaUrl = getFullUrl(item.image_url);
    const mediaIsVideo = isVideo(item.image_url);

    return (
      <View style={styles.slide}>
        <ScrollView
          maximumZoomScale={5}
          minimumZoomScale={1}
          centerContent={true}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          onStartShouldSetResponder={() => true}
          onResponderTerminationRequest={() => true}
          scrollEnabled={false} // Disable internal scroll to let FlatList handle swipes
        >
          <TouchableOpacity 
            activeOpacity={1} 
            onPress={selectionMode ? () => toggleSelection(item.id) : toggleDescription}
            onLongPress={isOwner && !selectionMode ? enterSelectionMode : null}
            style={styles.imageWrapper}
          >
            {mediaIsVideo ? (
              <Video
                source={{ uri: mediaUrl }}
                style={[
                  styles.fullPhoto,
                  isSelected && { opacity: 0.7 }
                ]}
                useNativeControls
                resizeMode={ResizeMode.CONTAIN}
                isLooping
                shouldPlay={currentIndex === index}
              />
            ) : (
              <Image 
                source={{ uri: mediaUrl }} 
                style={[
                  styles.fullPhoto,
                  isSelected && { opacity: 0.7 }
                ]} 
                resizeMode="contain" 
              />
            )}
            {selectionMode && (
              <View style={styles.selectionOverlay}>
                <Icon 
                  name={isSelected ? "checkbox" : "square-outline"} 
                  size={30} 
                  color={isSelected ? colors.primary : "#fff"} 
                />
              </View>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden={!showDescription} />
      
      <FlatList
        ref={flatListRef}
        data={photos}
        renderItem={renderItem}
        keyExtractor={(item) => item.id.toString()}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={currentIndex > 0 ? currentIndex : undefined}
        getItemLayout={(data, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
        onMomentumScrollEnd={(e) => {
          const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
          if (newIndex !== currentIndex) {
            setCurrentIndex(newIndex);
            // Fetch detailed info for the new photo and load its comments
            const photo = photos[newIndex];
            if (photo) {
              usersApi.getPhoto(photo.id).then(res => {
                const updatedPhotos = [...photos];
                updatedPhotos[newIndex] = res.data;
                setPhotos(updatedPhotos);
              });
              loadComments(photo.id);
            }
          }
        }}
        removeClippedSubviews={true}
        scrollEventThrottle={16}
        windowSize={5}
        maxToRenderPerBatch={3}
      />

      {/* Верхняя панель управления */}
      {(showDescription || selectionMode) && (
        <View style={[styles.header, selectionMode && { backgroundColor: 'rgba(0,0,0,0.8)' }]}>
          <TouchableOpacity 
            style={styles.backButton} 
            onPress={() => selectionMode ? setSelectionMode(false) : navigation.goBack()}
          >
            <Icon name={selectionMode ? "close-outline" : "chevron-back"} size={35} color="#fff" />
          </TouchableOpacity>
          
          <Text style={styles.headerTitle}>
            {selectionMode ? `Выбрано: ${selectedIds.length}` : `${currentIndex + 1} из ${photos.length}`}
          </Text>

          <View style={styles.headerRight}>
            {isOwner && (
              <TouchableOpacity onPress={deletePhotos} style={styles.headerButton}>
                <Icon name="trash-outline" size={28} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Описание и реакции (показываются по тапу) */}
      {showDescription && photos[currentIndex] && (
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.descriptionContainer, { backgroundColor: 'rgba(0,0,0,0.8)' }]}
        >
          <View style={styles.descriptionHeaderRow}>
            <View style={{ flex: 1 }}>
              <View style={styles.descriptionHeader}>
                <Text style={styles.descriptionText}>
                  {photos[currentIndex].description || 'Нет описания'}
                </Text>
                {photos[currentIndex].privacy === 'private' && (
                  <Icon name="lock-closed" size={16} color="#fff" style={{ marginLeft: 8 }} />
                )}
                {photos[currentIndex].privacy === 'friends' && (
                  <Icon name="people" size={16} color="#fff" style={{ marginLeft: 8 }} />
                )}
              </View>
              <Text style={styles.dateText}>
                {new Date(photos[currentIndex].created_at).toLocaleDateString()}
              </Text>
            </View>
            
            <View style={styles.reactionsContainer}>
              <TouchableOpacity 
                style={[styles.reactionButton, photos[currentIndex].my_reaction === 1 && styles.activeLike]} 
                onPress={() => handleReaction(1)}
              >
                <Icon name={photos[currentIndex].my_reaction === 1 ? "heart" : "heart-outline"} size={24} color={photos[currentIndex].my_reaction === 1 ? colors.error : "#fff"} />
                <Text style={styles.reactionText}>{photos[currentIndex].likes_count || 0}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.reactionButton, { marginLeft: 10 }, photos[currentIndex].my_reaction === -1 && styles.activeDislike]} 
                onPress={() => handleReaction(-1)}
              >
                <Icon name={photos[currentIndex].my_reaction === -1 ? "thumbs-down" : "thumbs-down-outline"} size={24} color={photos[currentIndex].my_reaction === -1 ? colors.primary : "#fff"} />
                <Text style={styles.reactionText}>{photos[currentIndex].dislikes_count || 0}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity 
            style={styles.commentsToggle} 
            onPress={() => setShowComments(!showComments)}
          >
            <Icon name="chatbubble-outline" size={20} color="#fff" />
            <Text style={styles.commentsToggleText}>
              Комментарии ({photos[currentIndex].comments_count || 0})
            </Text>
            <Icon name={showComments ? "chevron-down" : "chevron-up"} size={20} color="#fff" />
          </TouchableOpacity>

          {showComments && (
            <View style={styles.commentsSection}>
              <FlatList
                data={comments}
                keyExtractor={(item) => item.id.toString()}
                renderItem={({ item }) => (
                  <View style={styles.commentItem}>
                    <Image 
                      source={{ uri: getFullUrl(item.avatar_url) || 'https://via.placeholder.com/30' }} 
                      style={styles.commentAvatar} 
                    />
                    <View style={styles.commentContent}>
                      <View style={styles.commentHeader}>
                        <Text style={styles.commentUser}>
                          {item.first_name ? `${item.first_name} ${item.last_name || ''}` : `Пользователь #${item.user_id}`}
                        </Text>
                        {(isOwner || item.user_id === photos[currentIndex].user_id) && (
                          <TouchableOpacity onPress={() => deleteComment(item.id)}>
                            <Icon name="trash-outline" size={14} color="#ff4444" />
                          </TouchableOpacity>
                        )}
                      </View>
                      <Text style={styles.commentText}>{item.comment}</Text>
                      
                      <View style={styles.commentReactions}>
                        <TouchableOpacity 
                          onPress={() => handleCommentReaction(item.id, 1)}
                          style={styles.commentReactionButton}
                        >
                          <Icon 
                            name={item.my_reaction === 1 ? "heart" : "heart-outline"} 
                            size={14} 
                            color={item.my_reaction === 1 ? "#ff4444" : "#ccc"} 
                          />
                          <Text style={styles.commentReactionText}>{item.likes_count || 0}</Text>
                        </TouchableOpacity>
                        
                        <TouchableOpacity 
                          onPress={() => handleCommentReaction(item.id, -1)}
                          style={[styles.commentReactionButton, { marginLeft: 15 }]}
                        >
                          <Icon 
                            name={item.my_reaction === -1 ? "thumbs-down" : "thumbs-down-outline"} 
                            size={14} 
                            color={item.my_reaction === -1 ? colors.primary : "#ccc"} 
                          />
                          <Text style={styles.commentReactionText}>{item.dislikes_count || 0}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                )}
                style={{ maxHeight: 200 }}
                ListEmptyComponent={<Text style={styles.emptyComments}>Нет комментариев</Text>}
              />
              
              <View style={styles.commentInputContainer}>
                <TextInput
                  style={styles.commentInput}
                  placeholder="Ваш комментарий..."
                  placeholderTextColor="#999"
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
                    <Icon name="send" size={24} color={newComment.trim() ? colors.primary : "#666"} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { justifyContent: 'center', alignItems: 'center' },
  slide: { width: width, height: height, backgroundColor: '#000' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  imageWrapper: { width: width, height: height, justifyContent: 'center', alignItems: 'center' },
  selectionOverlay: {
    position: 'absolute',
    top: 120,
    right: 20,
    zIndex: 20
  },
  fullPhoto: { width: '100%', height: '100%' },
  header: { 
    position: 'absolute', 
    top: 0, 
    left: 0, 
    right: 0, 
    paddingTop: 40,
    paddingBottom: 10,
    paddingHorizontal: 20,
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    zIndex: 10
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerButton: { padding: 5, marginLeft: 15 },
  backButton: { padding: 5 },
  descriptionContainer: { 
    position: 'absolute', 
    bottom: 0, 
    left: 0, 
    right: 0, 
    padding: 20,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15
  },
  descriptionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 15
  },
  descriptionContent: { width: '100%' },
  descriptionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  descriptionText: { color: '#fff', fontSize: 16, lineHeight: 22, flex: 1 },
  dateText: { color: '#ccc', fontSize: 12, marginTop: 5 },
  reactionsContainer: { flexDirection: 'row', alignItems: 'center' },
  reactionButton: { flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)' },
  reactionText: { color: '#fff', marginLeft: 6, fontWeight: 'bold' },
  activeLike: { backgroundColor: 'rgba(239, 68, 68, 0.2)' },
  activeDislike: { backgroundColor: 'rgba(99, 102, 241, 0.2)' },
  commentsToggle: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingVertical: 10, 
    borderTopWidth: 1, 
    borderTopColor: 'rgba(255,255,255,0.1)' 
  },
  commentsToggleText: { color: '#fff', flex: 1, marginLeft: 10, fontSize: 14 },
  commentsSection: { marginTop: 10 },
  commentItem: { flexDirection: 'row', marginBottom: 12 },
  commentAvatar: { width: 30, height: 30, borderRadius: 15, marginRight: 10 },
  commentContent: { flex: 1 },
  commentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  commentUser: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  commentText: { color: '#ddd', fontSize: 14, marginBottom: 4 },
  commentReactions: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  commentReactionButton: { flexDirection: 'row', alignItems: 'center' },
  commentReactionText: { color: '#ccc', marginLeft: 4, fontSize: 12 },
  emptyComments: { color: '#999', textAlign: 'center', marginVertical: 10 },
  commentInputContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginTop: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    paddingHorizontal: 15
  },
  commentInput: { flex: 1, color: '#fff', paddingVertical: 8, maxHeight: 80 },
  sendButton: { padding: 5, marginLeft: 5 },
});
