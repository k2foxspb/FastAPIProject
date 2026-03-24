import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  Animated,
  PanResponder,
  ActivityIndicator,
  Dimensions,
  Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { createVideoPlayer, VideoView, useVideoPlayer } from 'expo-video';
import * as FileSystem from 'expo-file-system/legacy';
import { API_BASE_URL } from '../constants';
import { setPlaybackAudioMode } from '../utils/audioSettings';

const INLINE_SIZE = 170;
const MODAL_VIDEO_SIZE = 280;
const RING_STROKE = 7;
const RING_GAP = 8;
const M_OUTER = MODAL_VIDEO_SIZE + 2 * (RING_GAP + RING_STROKE);
const M_CENTER = M_OUTER / 2;
const M_RING_R = MODAL_VIDEO_SIZE / 2 + RING_GAP + RING_STROKE / 2;
const THUMB_R = 9;
const ARC_SEGMENTS = 120;
const DOT_SIZE = RING_STROKE + 1;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const MODAL_PAGE_X = (SCREEN_W - M_OUTER) / 2;
const MODAL_PAGE_Y = (SCREEN_H - M_OUTER) / 2;

const resolveRemoteUri = (path) => {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const base = API_BASE_URL.replace(/\/+$/, '');
  const rel = path.startsWith('/') ? path : `/${path}`;
  return `${base}${rel}`;
};

const formatTime = (secs) => {
  if (!secs || secs <= 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const getLocalCacheUri = (remoteUri) => {
  if (!remoteUri) return null;
  const seg = remoteUri.split('/');
  const filename = seg[seg.length - 1] || 'videonote.mp4';
  return FileSystem.cacheDirectory + 'vn_' + filename;
};

// Draw a progress arc using dot segments (works without SVG)
function ProgressRing({ progress }) {
  const thumbAngle = progress * 2 * Math.PI - Math.PI / 2;
  const thumbX = M_CENTER + M_RING_R * Math.cos(thumbAngle);
  const thumbY = M_CENTER + M_RING_R * Math.sin(thumbAngle);

  return (
    <View style={styles.ringContainer} pointerEvents="none">
      {Array.from({ length: ARC_SEGMENTS }, (_, i) => {
        const a = (i / ARC_SEGMENTS) * 2 * Math.PI - Math.PI / 2;
        const active = i / ARC_SEGMENTS <= progress;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: M_CENTER + M_RING_R * Math.cos(a) - DOT_SIZE / 2,
              top: M_CENTER + M_RING_R * Math.sin(a) - DOT_SIZE / 2,
              width: DOT_SIZE,
              height: DOT_SIZE,
              borderRadius: DOT_SIZE / 2,
              backgroundColor: active ? '#4FC3F7' : 'rgba(255,255,255,0.25)',
            }}
          />
        );
      })}
      {/* Thumb dot */}
      <View style={[styles.thumbDot, { left: thumbX - THUMB_R, top: thumbY - THUMB_R }]} />
    </View>
  );
}

const InlineCircleVideoContent = ({ uri }) => {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    try {
      p.audioMixingMode = 'mixWithOthers';
    } catch (e) {}
  });
  
  useEffect(() => {
    if (!player) return;
    
    // В списке чата мы не запускаем воспроизведение автоматически,
    // чтобы не тратить ресурсы и не мешать основному плееру.
    // Плеер просто покажет первый кадр как превью.
    try {
      player.pause();
    } catch (e) {}
    
    return () => {
      try {
        player.pause();
      } catch (e) {}
    };
  }, [player, uri]);

  return (
    <VideoView 
      player={player} 
      style={StyleSheet.absoluteFill} 
      contentFit="cover"
      nativeControls={false}
    />
  );
};

export default function VideoNoteMessage({ item, isReceived, isParentVisible }) {
  const remoteUri = resolveRemoteUri(item?.file_path || item?.video_url || item?.uri);

  const [playUri, setPlayUri] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);
  // player instance for modal — created lazily, destroyed on close
  const [modalPlayer, setModalPlayer] = useState(null);

  const playerRef = useRef(null);
  const durationRef = useRef(0);
  const isSeeking = useRef(false);
  const intervalRef = useRef(null);

  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const videoScale = useRef(new Animated.Value(0.1)).current;

  // Check local cache on mount
  useEffect(() => {
    if (!remoteUri) return;
    const localUri = getLocalCacheUri(remoteUri);
    if (!localUri) return;
    FileSystem.getInfoAsync(localUri).then(async (info) => {
      if (info.exists && info.size > 0) {
        setPlayUri(info.uri);
      } else if (info.exists && info.size === 0) {
        try {
          await FileSystem.deleteAsync(localUri, { idempotent: true });
        } catch (e) {}
      }
    });
  }, [remoteUri]);

  // Wire up listeners whenever modalPlayer changes
  useEffect(() => {
    const player = modalPlayer;
    if (!player) return;
    playerRef.current = player;

    const subs = [
      player.addListener('statusChange', ({ status }) => {
        if (status === 'readyToPlay') {
          setPlayerReady(true);
          const dur = player.duration || 0;
          if (dur > 0) {
            setDuration(dur);
            durationRef.current = dur;
          }
          // Принудительно запускаем в модале при готовности
          setPlaybackAudioMode().then(() => {
            player.play();
          }).catch(err => {
            console.log('[VideoNoteMessage] setPlaybackAudioMode error:', err);
            player.play();
          });
        } else if (status === 'idle') {
          setPlayerReady(false);
          setIsPlaying(false);
          setProgress(0);
          setCurrentTime(0);
        }
      }),
      player.addListener('playToEnd', () => {
        try { player.pause(); } catch (_) {}
        setIsPlaying(false);
        setProgress(0);
        setCurrentTime(0);
        try { player.currentTime = 0; } catch (_) {}
        setPlayerReady(true);
      }),
      player.addListener('playingChange', ({ isPlaying: playing }) => {
        setIsPlaying(playing);
      }),
    ];

    return () => {
      subs.forEach((s) => s.remove());
    };
  }, [modalPlayer]);

  // Poll current time while modal is open
  useEffect(() => {
    if (!isModalOpen) {
      clearInterval(intervalRef.current);
      return;
    }
    if (!playerReady) return;
    intervalRef.current = setInterval(() => {
      if (isSeeking.current) return;
      const p = playerRef.current;
      if (!p) return;
      const ct = p.currentTime || 0;
      const dur = durationRef.current || p.duration || 0;
      if (dur > 0 && durationRef.current === 0) {
        durationRef.current = dur;
        setDuration(dur);
      }
      setCurrentTime(ct);
      setProgress(dur > 0 ? Math.min(ct / dur, 1) : 0);
    }, 100);
    return () => clearInterval(intervalRef.current);
  }, [isModalOpen, playerReady]);

  const downloadFile = useCallback(async () => {
    if (!remoteUri) return null;
    const localUri = getLocalCacheUri(remoteUri);
    setDownloading(true);
    try {
      const result = await FileSystem.downloadAsync(remoteUri, localUri);
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Download failed with status ${result.status}`);
      }
      setPlayUri(result.uri);
      return result.uri;
    } catch (e) {
      console.warn('[VideoNoteMessage] download error:', e);
      try {
        await FileSystem.deleteAsync(localUri, { idempotent: true });
      } catch (_) {}
      setPlayUri(remoteUri);
      return remoteUri;
    } finally {
      setDownloading(false);
    }
  }, [remoteUri]);

  const openModal = useCallback(async () => {
    if (downloading) return;

    let uri = playUri;
    if (!uri) {
      uri = await downloadFile();
      if (!uri) return;
    }

    // Reset state
    setIsPlaying(false);
    setProgress(0);
    setCurrentTime(0);
    setPlayerReady(false);
    durationRef.current = 0;
    setDuration(0);

    // Create a fresh player — only one player exists while modal is open
    await setPlaybackAudioMode();
    const player = createVideoPlayer(uri);
    player.loop = false;
    try {
      player.audioMixingMode = 'doNotMix';
    } catch (e) {}
    playerRef.current = player;
    setModalPlayer(player);

    // Give it a small delay or wait for statusChange to ensure playback starts
    setTimeout(() => {
      if (playerRef.current === player) {
        player.play();
      }
    }, 100);

    backdropOpacity.setValue(0);
    videoScale.setValue(0.05);
    setIsModalOpen(true);
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(videoScale, { toValue: 1, friction: 8, tension: 50, useNativeDriver: true }),
    ]).start();
  }, [downloading, playUri, downloadFile, backdropOpacity, videoScale]);

  const closeModal = useCallback(() => {
    const player = playerRef.current;
    try { player?.pause(); } catch (_) {}

    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      Animated.timing(videoScale, { toValue: 0.05, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      setIsModalOpen(false);
      setIsPlaying(false);
      setProgress(0);
      setCurrentTime(0);
    // Release player to free native resources
    try { 
      player?.pause();
      player?.release?.(); 
    } catch (_) {}
      playerRef.current = null;
      setModalPlayer(null);
    });
  }, [backdropOpacity, videoScale]);

  const handlePlayPause = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (isPlaying) {
      try { p.pause(); } catch (_) {}
    } else {
      setPlaybackAudioMode().finally(() => {
        try { p.play(); } catch (_) {}
      });
    }
  }, [isPlaying]);

  const seekToProgressRef = useRef(null);
  const angleToProgressRef = useRef(null);

  seekToProgressRef.current = (prog) => {
    const dur = durationRef.current || 0;
    if (dur <= 0) return;
    const seekTime = Math.max(0, Math.min(prog, 1)) * dur;
    const p = playerRef.current;
    if (!p) return;
    try { p.currentTime = seekTime; } catch {
      try { p.seekBy(seekTime - (p.currentTime || 0)); } catch (_) {}
    }
    setCurrentTime(seekTime);
    setProgress(Math.min(prog, 1));
  };

  angleToProgressRef.current = (pageX, pageY) => {
    const cx = MODAL_PAGE_X + M_CENTER;
    const cy = MODAL_PAGE_Y + M_CENTER;
    const dx = pageX - cx;
    const dy = pageY - cy;
    let angle = Math.atan2(dx, -dy);
    if (angle < 0) angle += 2 * Math.PI;
    return angle / (2 * Math.PI);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => {
        const { pageX, pageY } = evt.nativeEvent;
        const cx = MODAL_PAGE_X + M_CENTER;
        const cy = MODAL_PAGE_Y + M_CENTER;
        const dist = Math.sqrt((pageX - cx) ** 2 + (pageY - cy) ** 2);
        return dist >= MODAL_VIDEO_SIZE / 2 + RING_GAP - 4 && dist <= M_OUTER / 2 + 8;
      },
      onMoveShouldSetPanResponder: (evt) => {
        const { pageX, pageY } = evt.nativeEvent;
        const cx = MODAL_PAGE_X + M_CENTER;
        const cy = MODAL_PAGE_Y + M_CENTER;
        const dist = Math.sqrt((pageX - cx) ** 2 + (pageY - cy) ** 2);
        return dist >= MODAL_VIDEO_SIZE / 2 + RING_GAP - 4 && dist <= M_OUTER / 2 + 8;
      },
      onPanResponderGrant: (evt) => {
        isSeeking.current = true;
        const p = playerRef.current;
        if (p) {
          try { p.pause(); } catch (_) {}
          setIsPlaying(false);
        }
        const prog = angleToProgressRef.current(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
        seekToProgressRef.current(prog);
      },
      onPanResponderMove: (evt) => {
        const prog = angleToProgressRef.current(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
        seekToProgressRef.current(prog);
      },
      onPanResponderRelease: (evt) => {
        const prog = angleToProgressRef.current(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
        seekToProgressRef.current(prog);
        isSeeking.current = false;
      },
      onPanResponderTerminate: () => {
        isSeeking.current = false;
      },
    })
  ).current;

  const durationLabel = formatTime(duration || durationRef.current);
  const currentLabel = formatTime(currentTime);
  const timeLabel = isPlaying || currentTime > 0
    ? `${currentLabel} / ${durationLabel}`
    : durationLabel;

  if (!remoteUri) return null;

  return (
    <>
      {/* Inline circle — static placeholder or player if visible */}
      <TouchableOpacity onPress={openModal} activeOpacity={0.85} style={styles.inlineContainer}>
        <View style={styles.inlineVideoWrap}>
          {isParentVisible ? (
            <InlineCircleVideoContent uri={playUri || remoteUri} />
          ) : (
            <View style={styles.inlinePlaceholder} />
          )}
          <View style={styles.inlineOverlay}>
            {downloading ? (
              <ActivityIndicator size="large" color="#fff" />
            ) : (
              <View style={styles.playBtnSmall}>
                <MaterialIcons name="play-arrow" size={32} color="#fff" />
              </View>
            )}
          </View>
        </View>
        {(duration > 0 || durationRef.current > 0) && (
          <View style={styles.timeBadge}>
            <Text style={styles.timeText}>{formatTime(duration || durationRef.current)}</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Modal — VideoView only here, with lazily created player */}
      <Modal
        visible={isModalOpen}
        transparent
        animationType="none"
        onRequestClose={closeModal}
        statusBarTranslucent
      >
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <TouchableWithoutFeedback onPress={closeModal}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>

          <Animated.View
            style={[
              styles.modalContent,
              { transform: [{ scale: videoScale }] },
            ]}
            {...panResponder.panHandlers}
          >
            <View style={styles.modalVideoWrap}>
              {modalPlayer && (
                <VideoView
                  player={modalPlayer}
                  style={styles.modalVideo}
                  contentFit="cover"
                  nativeControls={false}
                  allowsPictureInPicture={false}
                />
              )}
              {!playerReady && (
                <View style={[styles.modalVideo, { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }]}>
                  <ActivityIndicator size="large" color="#4FC3F7" />
                </View>
              )}
              <TouchableWithoutFeedback onPress={handlePlayPause}>
                <View style={styles.centerOverlay}>
                  {!isPlaying && (
                    <View style={styles.playBtnLarge}>
                      <MaterialIcons name="play-arrow" size={52} color="#fff" />
                    </View>
                  )}
                </View>
              </TouchableWithoutFeedback>
            </View>

            <ProgressRing progress={progress} />

            <View style={styles.modalTimeBadge}>
              <Text style={styles.timeText}>{timeLabel}</Text>
            </View>
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // ── Inline ──
  inlineContainer: {
    width: INLINE_SIZE,
    marginVertical: 2,
    alignItems: 'center',
  },
  inlineVideoWrap: {
    width: INLINE_SIZE,
    height: INLINE_SIZE,
    borderRadius: INLINE_SIZE / 2,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  inlinePlaceholder: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  inlineOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playBtnSmall: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.50)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  timeBadge: {
    marginTop: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  timeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  // ── Modal ──
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.96)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: M_OUTER,
    height: M_OUTER,
    borderRadius: M_OUTER / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  modalVideoWrap: {
    width: MODAL_VIDEO_SIZE,
    height: MODAL_VIDEO_SIZE,
    borderRadius: MODAL_VIDEO_SIZE / 2,
    overflow: 'hidden',
    backgroundColor: '#111',
    position: 'absolute',
  },
  modalVideo: {
    position: 'absolute',
    top: 0, left: 0,
    width: MODAL_VIDEO_SIZE,
    height: MODAL_VIDEO_SIZE,
    borderRadius: MODAL_VIDEO_SIZE / 2,
  },
  centerOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playBtnLarge: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(0,0,0,0.50)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  // ── Progress ring ──
  ringContainer: {
    position: 'absolute',
    top: 0, left: 0,
    width: M_OUTER,
    height: M_OUTER,
    backgroundColor: 'transparent',
  },
  thumbDot: {
    position: 'absolute',
    width: THUMB_R * 2,
    height: THUMB_R * 2,
    borderRadius: THUMB_R,
    backgroundColor: '#4FC3F7',
    shadowColor: '#4FC3F7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  // ── Modal extras ──
  modalTimeBadge: {
    position: 'absolute',
    bottom: RING_GAP + RING_STROKE + 6,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  closeButtonWrap: {
    position: 'absolute',
    top: SCREEN_H / 2 - M_OUTER / 2 - 14,
    right: SCREEN_W / 2 - M_OUTER / 2 - 14,
  },
  closeButtonInner: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
});
