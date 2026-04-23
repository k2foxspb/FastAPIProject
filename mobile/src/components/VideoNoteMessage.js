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
import { createVideoPlayer, VideoView } from 'expo-video';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../constants';
import { setPlaybackAudioMode } from '../utils/audioSettings';
import { acquireExclusive, releaseExclusive } from '../utils/downloadManager';

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

const formatBytes = (bytes) => {
  if (!bytes || bytes <= 0) return '0 КБ';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${Math.round(bytes / 1024)} КБ`;
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

const getDoneMarkerUri = (localUri) => localUri + '.done';
const getResumeStorageKey = (localUri) => `dl_resume_${localUri.split('/').pop()}`;

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
  const playerRef = useRef(null);
  const [player, setPlayer] = useState(null);

  useEffect(() => {
    if (!uri) return;
    let p;
    try {
      p = createVideoPlayer(uri);
      p.loop = true;
      p.muted = true;
      try { p.audioMixingMode = 'mixWithOthers'; } catch (e) {}
      p.pause();
    } catch (e) {
      return;
    }
    playerRef.current = p;
    setPlayer(p);

    return () => {
      setPlayer(null);
      playerRef.current = null;
      try { p.release(); } catch (e) {}
    };
  }, [uri]);

  if (!player) return null;

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
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [isStalled, setIsStalled] = useState(false);
  const [cached, setCached] = useState(false);
  const stalledTimerRef = useRef(null);
  const lastBytesRef = useRef(0);
  const downloadResumableRef = useRef(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);
  // player instance for modal — created lazily, destroyed on close
  // NOTE: player is stored only in ref to avoid React re-render race with VideoView
  const [showVideoView, setShowVideoView] = useState(false);
  const modalPlayerRef = useRef(null);

  const playerRef = useRef(null);
  const durationRef = useRef(0);
  const isSeeking = useRef(false);
  const intervalRef = useRef(null);

  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const videoScale = useRef(new Animated.Value(0.1)).current;
  const exclusiveIdRef = useRef(null);
  const downloadIdRef = useRef(null);

  // Pause and save resume state on unmount
  useEffect(() => {
    return () => {
      const resumable = downloadResumableRef.current;
      if (resumable && remoteUri) {
        const localUri = getLocalCacheUri(remoteUri);
        const resumeKey = getResumeStorageKey(localUri);
        resumable.pauseAsync().then(savable => {
          if (savable && typeof savable === 'object' && savable.url &&
              savable.resumeData && typeof savable.resumeData === 'string' && savable.resumeData !== '0' && savable.resumeData.startsWith('{')) {
            AsyncStorage.setItem(resumeKey, JSON.stringify(savable)).catch(() => {})
          }
        }).catch(() => {});
      }
    };
  }, [remoteUri]);

  // Check local cache on mount
  useEffect(() => {
    if (!remoteUri) return;
    const localUri = getLocalCacheUri(remoteUri);
    if (!localUri) return;
    FileSystem.getInfoAsync(getDoneMarkerUri(localUri)).then(async (markerInfo) => {
      if (markerInfo.exists) {
        // Marker exists — file fully downloaded
        const fileInfo = await FileSystem.getInfoAsync(localUri);
        if (fileInfo.exists && fileInfo.size > 0) {
          setPlayUri(fileInfo.uri);
          setCached(true);
        } else {
          // File missing despite marker — clean up
          try { await FileSystem.deleteAsync(getDoneMarkerUri(localUri), { idempotent: true }); } catch (e) {}
        }
      } else {
        // No marker — partial or missing file, clean up
        try { await FileSystem.deleteAsync(localUri, { idempotent: true }); } catch (e) {}
      }
    });
  }, [remoteUri]);

  // Wire up listeners whenever showVideoView changes (player is in ref)
  useEffect(() => {
    if (!showVideoView) return;
    const player = modalPlayerRef.current;
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
  }, [showVideoView]);

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

  const downloadFileBackground = useCallback(async () => {
    if (!remoteUri) return;
    const localUri = getLocalCacheUri(remoteUri);
    const resumeKey = getResumeStorageKey(localUri);
    setDownloading(prev => { if (!prev) return true; return prev; });
    setCached(false);
    setIsStalled(false);
    lastBytesRef.current = 0;

    const MAX_RETRIES = 3;
    let attempt = 0;
    while (attempt < MAX_RETRIES) {
      let resumable = null;
      try {
        // Try to resume from saved state
        let savedResumeData = null;
        try {
          const saved = await AsyncStorage.getItem(resumeKey);
          if (saved) {
            // Validate: must be a JSON string with url field (not "0" or garbage)
            try {
              const parsed = JSON.parse(saved);
              if (parsed && typeof parsed === 'object' && parsed.url &&
                parsed.resumeData && typeof parsed.resumeData === 'string' && parsed.resumeData !== '0' && parsed.resumeData.startsWith('{')) {
                savedResumeData = saved;
              } else await AsyncStorage.removeItem(resumeKey);
            } catch (_) { await AsyncStorage.removeItem(resumeKey); }
          }
        } catch (_) {}

        const progressCallback = (progress) => {
          const loaded = progress.totalBytesWritten || 0;
          const total = progress.totalBytesExpectedToWrite || 0;
          setDownloadedBytes(loaded);
          setTotalBytes(total);
          if (loaded === lastBytesRef.current) {
            if (!stalledTimerRef.current) {
              stalledTimerRef.current = setTimeout(() => setIsStalled(true), 3000);
            }
          } else {
            lastBytesRef.current = loaded;
            if (stalledTimerRef.current) {
              clearTimeout(stalledTimerRef.current);
              stalledTimerRef.current = null;
            }
            setIsStalled(false);
          }
        };

        if (savedResumeData) {
          // Resume from where we left off
          resumable = FileSystem.createDownloadResumable(remoteUri, localUri, {}, progressCallback, savedResumeData);
        } else {
          // Fresh download — delete any partial file
          try { await FileSystem.deleteAsync(localUri, { idempotent: true }); } catch (_) {}
          try { await FileSystem.deleteAsync(getDoneMarkerUri(localUri), { idempotent: true }); } catch (_) {}
          setDownloadedBytes(0);
          setTotalBytes(0);
          lastBytesRef.current = 0;
          resumable = FileSystem.createDownloadResumable(remoteUri, localUri, {}, progressCallback);
        }
        downloadResumableRef.current = resumable;

        const result = savedResumeData
          ? await resumable.resumeAsync()
          : await resumable.downloadAsync();

        // Clear saved resume data on success
        try { await AsyncStorage.removeItem(resumeKey); } catch (_) {}

        if (result && result.status >= 200 && result.status < 300) {
          // Verify file actually exists on disk before marking as cached
          const verify = await FileSystem.getInfoAsync(localUri);
          if (verify.exists && verify.size > 0) {
            // Write done marker to confirm full download
            try { await FileSystem.writeAsStringAsync(getDoneMarkerUri(localUri), '1'); } catch (_) {}
            setPlayUri(verify.uri);
            setCached(true);
          } else {
            // File missing or empty — delete and don't mark cached
            try { await FileSystem.deleteAsync(localUri, { idempotent: true }); } catch (_) {}
          }
        }
        // Success — exit loop
        break;
      } catch (e) {
        // Save resume state so next open can continue from here
        if (resumable) {
          try {
            const savable = await resumable.pauseAsync();
            if (savable && typeof savable === 'object' && savable.url &&
                savable.resumeData && typeof savable.resumeData === 'string' && savable.resumeData !== '0' && savable.resumeData.startsWith('{')) {
              await AsyncStorage.setItem(resumeKey, JSON.stringify(savable));
            }
          } catch (_) {}
        }
        attempt += 1;
        const isRefused = e?.message && (e.message.includes('REFUSED_STREAM') || e.message.includes('stream was reset'));
        if (isRefused && attempt < MAX_RETRIES) {
          console.warn(`[VideoNoteMessage] REFUSED_STREAM, retry ${attempt}/${MAX_RETRIES - 1}...`);
          await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        } else {
          console.warn('[VideoNoteMessage] background download error:', e);
          break;
        }
      }
    }

    downloadResumableRef.current = null;
    // Keep downloadedBytes/totalBytes so badge stays visible after download
    setDownloading(false);
    setIsStalled(false);
    if (stalledTimerRef.current) {
      clearTimeout(stalledTimerRef.current);
      stalledTimerRef.current = null;
    }
  }, [remoteUri]);

  const openModal = useCallback(async () => {
    // Allow opening even if background download is in progress

    // Use cached local file if available, otherwise stream directly from remote
    const uri = playUri || remoteUri;
    if (!uri) return;

    // Reset state
    setIsPlaying(false);
    setProgress(0);
    setCurrentTime(0);
    setPlayerReady(false);
    durationRef.current = 0;
    setDuration(0);

    // Acquire exclusive mode — pause all OTHER background downloads
    exclusiveIdRef.current = acquireExclusive();

    // Start background download for caching AFTER acquiring exclusive (so it won't be paused)
    if (!playUri) {
      setDownloading(true);
      setDownloadedBytes(0);
      setTotalBytes(0);
      downloadFileBackground();
    }

    // Create a fresh player — only one player exists while modal is open
    try { await setPlaybackAudioMode(); } catch (e) { console.warn('[VideoNoteMessage] setPlaybackAudioMode error:', e); }
    const player = createVideoPlayer(uri);
    player.loop = false;
    try {
      player.audioMixingMode = 'doNotMix';
    } catch (e) {}
    playerRef.current = player;
    modalPlayerRef.current = player;
    setShowVideoView(true);

    backdropOpacity.setValue(0);
    videoScale.setValue(0.05);
    setIsModalOpen(true);
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(videoScale, { toValue: 1, friction: 8, tension: 50, useNativeDriver: true }),
    ]).start();
  }, [playUri, remoteUri, downloadFileBackground, backdropOpacity, videoScale]);

  const closeModal = useCallback(() => {
    // Release exclusive mode — resume all paused background downloads
    if (exclusiveIdRef.current) {
      releaseExclusive(exclusiveIdRef.current);
      exclusiveIdRef.current = null;
    }
    const player = playerRef.current;
    try { player?.pause(); } catch (_) {}
    // Step 1: hide VideoView (unmount it) BEFORE releasing the player
    playerRef.current = null;
    modalPlayerRef.current = null;
    setShowVideoView(false);

    // Step 2: release player on next tick — after VideoView has unmounted
    setTimeout(() => {
      try { player?.release?.(); } catch (_) {}
    }, 0);

    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      Animated.timing(videoScale, { toValue: 0.05, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      setIsModalOpen(false);
      setIsPlaying(false);
      setProgress(0);
      setCurrentTime(0);
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
          {isParentVisible && !isModalOpen ? (
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
        <View style={styles.inlineStatusBadge} pointerEvents="none">
          {cached && !downloading ? (
            <MaterialIcons name="check-circle" size={16} color="#4FC3F7" />
          ) : downloading ? (
            <>
              <View style={styles.inlineStatusRow}>
                <ActivityIndicator size={10} color="#4FC3F7" style={{ marginRight: 4 }} />
                {downloadedBytes > 0 && (
                  <Text style={styles.inlineStatusText}>
                    {totalBytes > 0
                      ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
                      : formatBytes(downloadedBytes)}
                  </Text>
                )}
              </View>
              {totalBytes > 0 && downloadedBytes > 0 && (
                <View style={styles.inlineStatusTrack}>
                  <View style={[styles.inlineStatusFill, { width: `${Math.min(downloadedBytes / totalBytes, 1) * 100}%` }]} />
                </View>
              )}
            </>
          ) : (
            <MaterialIcons name="cloud-download" size={16} color="rgba(255,255,255,0.7)" />
          )}
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
              {showVideoView && modalPlayerRef.current && (
                <VideoView
                  player={modalPlayerRef.current}
                  style={styles.modalVideo}
                  contentFit="cover"
                  nativeControls={false}
                  allowsPictureInPicture={false}
                />
              )}
              {!playerReady && (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', borderRadius: MODAL_VIDEO_SIZE / 2, zIndex: 2 }]}>
                  <ActivityIndicator size="large" color="#4FC3F7" />
                </View>
              )}
              {playerReady && (
                <TouchableWithoutFeedback onPress={handlePlayPause}>
                  <View style={styles.centerOverlay}>
                    {!isPlaying && (
                      <View style={styles.playBtnLarge}>
                        <MaterialIcons name="play-arrow" size={52} color="#fff" />
                      </View>
                    )}
                  </View>
                </TouchableWithoutFeedback>
              )}
            </View>

            <ProgressRing progress={progress} />

            <View style={styles.modalTimeBadge}>
              <Text style={styles.timeText}>{timeLabel}</Text>
            </View>
          </Animated.View>

          <View style={styles.downloadBadgeOuter}>
            <View style={styles.downloadBadge}>
              {cached && !downloading ? (
                <Text style={styles.downloadBytesText}>✓ в кэше  {downloadedBytes > 0 ? formatBytes(downloadedBytes) : ''}</Text>
              ) : downloading ? (
                <>
                  {downloadedBytes > 0 ? (
                    <Text style={styles.downloadBytesText}>
                      {totalBytes > 0
                        ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
                        : formatBytes(downloadedBytes)}
                    </Text>
                  ) : (
                    <Text style={styles.downloadBytesText}>загрузка…</Text>
                  )}
                  {totalBytes > 0 && downloadedBytes > 0 && (
                    <View style={styles.progressBarTrack}>
                      <View style={[styles.progressBarFill, { width: `${Math.min(downloadedBytes / totalBytes, 1) * 100}%` }]} />
                    </View>
                  )}
                  {isStalled && <Text style={styles.stallSubText}>медленное соединение…</Text>}
                </>
              ) : (
                <Text style={styles.downloadBytesText}>не загружено</Text>
              )}
            </View>
          </View>
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
  inlineStatusBadge: {
    marginTop: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 6,
    alignItems: 'center',
    alignSelf: 'center',
    maxWidth: INLINE_SIZE,
  },
  inlineStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inlineStatusText: {
    color: '#4FC3F7',
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
  },
  inlineStatusTrack: {
    width: INLINE_SIZE - 16,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 2,
    marginTop: 2,
    overflow: 'hidden',
  },
  inlineStatusFill: {
    height: 3,
    backgroundColor: '#4FC3F7',
    borderRadius: 2,
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
  downloadBadgeOuter: {
    position: 'absolute',
    top: SCREEN_H / 2 + M_OUTER / 2 + 12,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  downloadBadge: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    minWidth: 140,
  },
  downloadBytesText: {
    color: '#4FC3F7',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  progressBarTrack: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 4,
    backgroundColor: '#4FC3F7',
    borderRadius: 2,
  },
  stallSubText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    marginTop: 3,
  },
});
