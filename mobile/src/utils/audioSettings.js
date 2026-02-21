import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';

/**
 * Устанавливает режим аудио для воспроизведения медиа.
 * Включает прерывание звука из других приложений (они встают на паузу).
 */
export const setPlaybackAudioMode = async () => {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      playThroughEarpieceAndroid: false,
      staysActiveInBackground: false,
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
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      playThroughEarpieceAndroid: false,
      staysActiveInBackground: false,
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
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      interruptionModeIOS: InterruptionModeIOS.DuckOthers,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      playThroughEarpieceAndroid: false,
      staysActiveInBackground: false,
    });
  } catch (e) {
    console.log('[AudioSettings] Error setting notification mode:', e);
  }
};
