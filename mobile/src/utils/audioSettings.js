import { setAudioModeAsync } from 'expo-audio';

/**
 * Устанавливает режим аудио для воспроизведения медиа.
 * Включает прерывание звука из других приложений (они встают на паузу).
 */
export const setPlaybackAudioMode = async () => {
  try {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
  } catch (e) {
    console.log('[AudioSettings] Error setting playback mode:', e);
  }
};

/**
 * Устанавливает режим аудио для записи голосовых сообщений.
 */
export const setRecordingAudioMode = async () => {
  try {
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
  } catch (e) {
    console.log('[AudioSettings] Error setting recording mode:', e);
  }
};

/**
 * Устанавливает режим аудио для коротких уведомлений.
 * Другие приложения приглушаются (ducking), но не останавливаются полностью.
 */
export const setNotificationAudioMode = async () => {
  try {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
  } catch (e) {
    console.log('[AudioSettings] Error setting notification mode:', e);
  }
};
