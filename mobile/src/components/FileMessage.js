import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { API_BASE_URL } from '../constants';

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
        const downloadRes = await FileSystem.downloadAsync(remoteUri, localFileUri);
        uri = downloadRes.uri;
      }

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri);
      } else {
        Alert.alert('Ошибка', 'Открытие файлов не поддерживается на этом устройстве');
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
