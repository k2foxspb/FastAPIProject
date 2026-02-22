import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { documentDirectory, getInfoAsync, downloadAsync, getContentUriAsync, readAsStringAsync, writeAsStringAsync, EncodingType, StorageAccessFramework } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { API_BASE_URL } from '../constants';

const getMimeType = (fileName) => {
  try {
    if (!fileName || typeof fileName !== 'string') return '*/*';
    const parts = fileName.split('.');
    if (parts.length < 2) return '*/*';
    const extension = parts.pop();
    if (!extension) return '*/*';
    const extensionLower = extension.toLowerCase();
    const mimeTypes = {
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'txt': 'text/plain',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'zip': 'application/zip',
      'rar': 'application/x-rar-compressed',
      'mp3': 'audio/mpeg',
      'mp4': 'video/mp4',
    };
    return mimeTypes[extensionLower] || '*/*';
  } catch (err) {
    console.error('[FileMessage] getMimeType error:', err);
    return '*/*';
  }
};

const resolveRemoteUri = (path) => {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const base = API_BASE_URL.replace(/\/+$/, '');
  const rel = path.startsWith('/') ? path : `/${path}`;
  return `${base}${rel}`;
};

export default function FileMessage({ item, currentUserId }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [loading, setLoading] = useState(false);

  const remoteUri = resolveRemoteUri(item.file_path);
  const fileName = item.file_path ? item.file_path.split('/').pop() : 'Без названия';
  const localFileUri = item.file_path ? `${documentDirectory}${fileName}` : null;

  const handleDownloadAndOpen = async () => {
    if (Platform.OS === 'web') {
      const win = window.open(remoteUri, '_blank');
      if (win) win.focus();
      return;
    }
    if (!item.file_path || !localFileUri) {
      Alert.alert('Ошибка', 'Путь к файлу отсутствует');
      return;
    }
    setLoading(true);
    try {
      const fileInfo = await getInfoAsync(localFileUri);
      let uri = localFileUri;

      if (!fileInfo.exists) {
        console.log(`Downloading ${remoteUri} to ${localFileUri}`);
        const downloadRes = await downloadAsync(remoteUri, localFileUri);
        uri = downloadRes.uri;
      }

      console.log(`Opening file: ${uri}`);
      
      const mimeType = getMimeType(fileName);

      if (Platform.OS === 'android') {
        try {
          const contentUri = await getContentUriAsync(uri);
          await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
            data: contentUri,
            flags: 1,
            type: mimeType,
          });
        } catch (e) {
          console.log('IntentLauncher failed, falling back to Sharing', e);
          await Sharing.shareAsync(uri, { mimeType });
        }
      } else {
        await Sharing.shareAsync(uri, { mimeType });
      }
    } catch (error) {
      console.error('Error opening file:', error);
      Alert.alert('Ошибка', 'Не удалось открыть файл');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (Platform.OS === 'web') {
      try {
        const link = document.createElement('a');
        link.href = remoteUri;
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (e) {
        window.open(remoteUri, '_blank');
      }
      return;
    }
    if (!item.file_path || !localFileUri) {
      Alert.alert('Ошибка', 'Путь к файлу отсутствует');
      return;
    }
    setLoading(true);
    try {
      const fileInfo = await getInfoAsync(localFileUri);
      let uri = localFileUri;

      if (!fileInfo.exists) {
        console.log(`Downloading ${remoteUri} to ${localFileUri}`);
        const downloadRes = await downloadAsync(remoteUri, localFileUri);
        uri = downloadRes.uri;
      }

      if (Platform.OS === 'android') {
        const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
          const mimeType = getMimeType(fileName);
          const newFileUri = await StorageAccessFramework.createFileAsync(
            permissions.directoryUri,
            fileName,
            mimeType
          );
          await writeAsStringAsync(newFileUri, base64, { encoding: EncodingType.Base64 });
          Alert.alert('Успех', 'Файл успешно сохранен');
        }
      } else {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri);
        } else {
          Alert.alert('Ошибка', 'Функция "Поделиться" недоступна');
        }
      }
    } catch (error) {
      console.error('Error downloading file:', error);
      Alert.alert('Ошибка', 'Не удалось скачать файл');
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Инфо', 'Используйте функцию "Поделиться" вашего браузера');
      return;
    }
    if (!item.file_path || !localFileUri) {
      Alert.alert('Ошибка', 'Путь к файлу отсутствует');
      return;
    }
    setLoading(true);
    try {
      const fileInfo = await getInfoAsync(localFileUri);
      let uri = localFileUri;

      if (!fileInfo.exists) {
        const downloadRes = await downloadAsync(remoteUri, localFileUri);
        uri = downloadRes.uri;
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        Alert.alert('Ошибка', 'Функция "Поделиться" недоступна');
      }
    } catch (error) {
      console.error('Error sharing file:', error);
      Alert.alert('Ошибка', 'Не удалось скачать файл для отправки');
    } finally {
      setLoading(false);
    }
  };

  const isReceived = item.sender_id !== currentUserId;

  return (
    <View style={[
      styles.container, 
      { 
        backgroundColor: isReceived ? colors.surface : colors.primary,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 1,
      }
    ]}>
      <TouchableOpacity 
        onPress={handleDownloadAndOpen} 
        disabled={loading} 
        style={styles.contentContainer}
      >
        <View style={[styles.iconContainer, { backgroundColor: isReceived ? colors.primary + '15' : 'rgba(255,255,255,0.2)' }]}>
          {loading ? (
            <ActivityIndicator size="small" color={isReceived ? colors.primary : "#fff"} />
          ) : (
            <MaterialIcons 
              name="insert-drive-file" 
              size={24} 
              color={isReceived ? colors.primary : "#fff"} 
            />
          )}
        </View>
        <View style={styles.textContainer}>
          <Text 
            style={[styles.fileName, { color: isReceived ? colors.text : "#fff" }]} 
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {fileName}
          </Text>
          <Text style={[styles.fileAction, { color: isReceived ? colors.textSecondary : 'rgba(255,255,255,0.7)' }]}>
            Нажмите, чтобы открыть
          </Text>
        </View>
      </TouchableOpacity>
      
      <TouchableOpacity 
        onPress={handleDownload}
        disabled={loading}
        style={[styles.downloadButton, { borderLeftColor: isReceived ? colors.border : 'rgba(255,255,255,0.3)' }]}
      >
        <MaterialIcons 
          name="file-download" 
          size={22} 
          color={isReceived ? colors.textSecondary : "#fff"} 
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 16,
    marginVertical: 2,
    minWidth: 220,
    maxWidth: 280,
  },
  contentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  downloadButton: {
    padding: 8,
    marginLeft: 8,
    borderLeftWidth: 1,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  textContainer: {
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
  },
  fileAction: {
    fontSize: 11,
    marginTop: 2,
  },
});
