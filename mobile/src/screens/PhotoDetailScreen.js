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
  StatusBar
} from 'react-native';
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
  const flatListRef = useRef(null);

  const fetchAlbumPhotos = useCallback(async () => {
    if (initialPhotos) {
      const idx = initialPhotos.findIndex(p => p.id === photoId);
      if (idx !== -1) setCurrentIndex(idx);
      return;
    }

    try {
      setLoading(true);
      const photoRes = await usersApi.getPhoto(photoId);
      const targetAlbumId = photoRes.data.album_id;
      
      if (targetAlbumId) {
        const albumRes = await usersApi.getAlbum(targetAlbumId);
        const albumPhotos = albumRes.data.photos || [];
        setPhotos(albumPhotos);
        const idx = albumPhotos.findIndex(p => p.id === photoId);
        if (idx !== -1) setCurrentIndex(idx);
      } else {
        setPhotos([photoRes.data]);
        setCurrentIndex(0);
      }
    } catch (err) {
      console.error('Error fetching photos:', err);
      Alert.alert('Ошибка', 'Не удалось загрузить фотографии');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [photoId, initialPhotos, navigation]);

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

  const renderItem = ({ item, index }) => {
    const isSelected = selectedIds.includes(item.id);
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
            <Image 
              source={{ uri: getFullUrl(item.image_url) }} 
              style={[
                styles.fullPhoto,
                isSelected && { opacity: 0.7 }
              ]} 
              resizeMode="contain" 
            />
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
          setCurrentIndex(newIndex);
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

      {/* Описание (показывается по тапу) */}
      {showDescription && photos[currentIndex] && (
        <View style={[styles.descriptionContainer, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
          <ScrollView style={styles.descriptionContent}>
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
          </ScrollView>
        </View>
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
    maxHeight: '30%',
    padding: 20,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15
  },
  descriptionContent: { width: '100%' },
  descriptionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  descriptionText: { color: '#fff', fontSize: 16, lineHeight: 22 },
  dateText: { color: '#ccc', fontSize: 12, marginTop: 10 },
});
