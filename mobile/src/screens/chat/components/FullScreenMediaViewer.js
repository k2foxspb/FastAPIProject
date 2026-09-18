import React from 'react';
import { View, Text, FlatList, TouchableOpacity, Modal, Pressable, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import CachedMedia from '../../../components/CachedMedia';
import { styles } from '../styles';
import { formatMediaTime, formatBytesRu, isVideoMedia } from '../utils';

// Модальное окно полноэкранного просмотра фото/видео с кастомными контролами
export default function FullScreenMediaViewer({
  fullScreenMedia,
  screenWidth,
  currentMediaIndex,
  showFullScreenControls,
  fullScreenPosition,
  fullScreenDuration,
  fullScreenIsPlaying,
  fullScreenPlaybackRate,
  fullScreenSliderWidth,
  isSeekingFullScreen,
  seekingPositionFullScreen,
  fsDownloading,
  fsDownloadedBytes,
  fsTotalBytes,
  fsIsStalled,
  sliderPanHandlers,
  onClose,
  onDownload,
  onToggleControls,
  onPlayPause,
  onToggleRate,
  onMediaIndexChange,
  onDownloadProgress,
  onPlayerReady,
  onSliderLayout,
}) {
  const currentMedia = fullScreenMedia?.list[currentMediaIndex];
  const isCurrentVideo = isVideoMedia(currentMedia);
  const displayedPosition = isSeekingFullScreen ? (seekingPositionFullScreen ?? fullScreenPosition) : fullScreenPosition;

  return (
    <Modal
      visible={!!fullScreenMedia}
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.fullScreenContainer}>
        <View style={styles.fullScreenControlsTop}>
          <TouchableOpacity 
            style={styles.fullScreenIconButton} 
            onPress={onDownload}
          >
            <MaterialIcons name="file-download" size={30} color="white" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.fullScreenIconButton} 
            onPress={onClose}
          >
            <MaterialIcons name="close" size={30} color="white" />
          </TouchableOpacity>
        </View>
        
        <FlatList
          data={fullScreenMedia?.list || []}
          horizontal
          pagingEnabled
          initialScrollIndex={fullScreenMedia?.index || 0}
          getItemLayout={(_, index) => ({
            length: screenWidth,
            offset: screenWidth * index,
            index,
          })}
          onMomentumScrollEnd={(e) => {
            const index = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
            onMediaIndexChange(index);
          }}
          keyExtractor={(_, i) => `fs_media_${i}`}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item: mediaItem, index }) => (
            <View style={{ width: screenWidth, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
              <CachedMedia 
                item={mediaItem}
                style={styles.fullScreenVideo}
                resizeMode="contain"
                useNativeControls={false}
                isLooping={false}
                shouldPlay={currentMediaIndex === index}
                isMuted={false}
                isStatic={index !== currentMediaIndex}
                isParentVisible={true}
                onDownloadProgress={(downloaded, total, stalled, isCached) => onDownloadProgress(index, downloaded, total, stalled, isCached)}
                onPlayerReady={(player) => onPlayerReady(index, player)}
              />

              <Pressable style={StyleSheet.absoluteFill} onPress={onToggleControls}>
                {showFullScreenControls && isVideoMedia(mediaItem) && (
                  <View style={styles.fullScreenCenterButtonContainer}>
                    <TouchableOpacity 
                      style={styles.fullScreenCenterPlayButton} 
                      onPress={onPlayPause}
                    >
                      <MaterialIcons 
                        name={fullScreenIsPlaying ? "pause" : "play-arrow"} 
                        size={50} 
                        color="white" 
                      />
                    </TouchableOpacity>
                  </View>
                )}
              </Pressable>
            </View>
          )}
        />

        {fsDownloading && isCurrentVideo && (
          <View style={styles.fsDownloadBadge} pointerEvents="none">
            {fsDownloadedBytes > 0 ? (
              <Text style={styles.fsDownloadBytesText}>
                {fsTotalBytes > 0
                  ? `${formatBytesRu(fsDownloadedBytes)} / ${formatBytesRu(fsTotalBytes)}`
                  : formatBytesRu(fsDownloadedBytes)}
              </Text>
            ) : (
              <Text style={styles.fsDownloadBytesText}>загрузка…</Text>
            )}
            {fsTotalBytes > 0 && fsDownloadedBytes > 0 && (
              <View style={styles.fsProgressBarTrack}>
                <View style={[styles.fsProgressBarFill, { width: `${Math.min(fsDownloadedBytes / fsTotalBytes, 1) * 100}%` }]} />
              </View>
            )}
            {fsIsStalled && <Text style={styles.fsStallText}>медленное соединение…</Text>}
          </View>
        )}

        {showFullScreenControls && isCurrentVideo && (
          <View style={styles.fullScreenControlsBottom}>
            <View style={{ position: 'absolute', top: -50, right: 20 }}>
              <TouchableOpacity 
                onPress={onToggleRate} 
                style={{ backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }}
              >
                <Text style={{ color: 'white', fontWeight: 'bold' }}>{fullScreenPlaybackRate}x</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.fullScreenTimelineRow}>
              <Text style={styles.fullScreenTimeText}>
                {formatMediaTime(displayedPosition)}
              </Text>

              <View
                style={styles.fullScreenSliderContainer}
                onLayout={onSliderLayout}
                {...sliderPanHandlers}
              >
                <View style={styles.fullScreenSliderTrack} pointerEvents="none" />
                <View
                  pointerEvents="none"
                  style={[
                    styles.fullScreenSliderFill,
                    {
                      width: `${
                        fullScreenDuration > 0
                          ? ((displayedPosition / fullScreenDuration) * 100).toFixed(2)
                          : 0
                      }%`,
                    },
                  ]}
                />
                <View
                  pointerEvents="none"
                  style={[
                    styles.fullScreenSliderThumb,
                    {
                      left:
                        fullScreenDuration > 0
                          ? Math.max(
                              0,
                              Math.min(
                                fullScreenSliderWidth - 12,
                                (displayedPosition / fullScreenDuration) * fullScreenSliderWidth - 6
                              )
                            )
                          : 0,
                    },
                  ]}
                />
              </View>

              <Text style={styles.fullScreenTimeText}>{formatMediaTime(fullScreenDuration)}</Text>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}
