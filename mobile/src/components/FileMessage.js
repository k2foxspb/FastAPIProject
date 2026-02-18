import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { API_BASE_URL } from '../constants';

const getMimeType = (fileName) => {
  const extension = fileName.split('.').pop().toLowerCase();
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
  return mimeTypes[extension] || '*/*';
};

export default function FileMessage({ item, currentUserId }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [loading, setLoading] = useState(false);

  const remoteUri = `${API_BASE_URL}${item.file_path}`;
  const fileName = item.file_path.split('/').pop();
  const localFileUri = `${FileSystem.documentDirectory}${fileName}`;

  const handleDownloadAndOpen = async () => {
    setLoading(true);
    try {
      const fileInfo = await FileSystem.getInfoAsync(localFileUri);
      let uri = localFileUri;

      if (!fileInfo.exists) {
        console.log(`Downloading ${remoteUri} to ${localFileUri}`);
        const downloadRes = await FileSystem.downloadAsync(remoteUri, localFileUri);
        uri = downloadRes.uri;
      }

      console.log(`Opening file: ${uri}`);
      
      const mimeType = getMimeType(fileName);

      if (Platform.OS === 'android') {
        try {
          const contentUri = await FileSystem.getContentUriAsync(uri);
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

  const isReceived = item.sender_id !== currentUserId;

  return (
    <TouchableOpacity 
      onPress={handleDownloadAndOpen} 
      disabled={loading} 
      style={[
        styles.container, 
        { backgroundColor: isReceived ? colors.border + '40' : 'rgba(255,255,255,0.2)' }
      ]}
    >
      <View style={styles.iconContainer}>
        {loading ? (
          <ActivityIndicator size="small" color={isReceived ? colors.primary : "#fff"} />
        ) : (
          <MaterialIcons 
            name="insert-drive-file" 
            size={28} 
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
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    marginVertical: 4,
    minWidth: 180,
    maxWidth: 250,
  },
  iconContainer: {
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
