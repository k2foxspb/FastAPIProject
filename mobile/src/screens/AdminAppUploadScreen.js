import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { adminApi } from '../api';
import { uploadManager } from '../utils/uploadManager';

export default function AdminAppUploadScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const [file, setFile] = useState(null);
  const [version, setVersion] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentUploadId, setCurrentUploadId] = useState(null);

  useEffect(() => {
    return () => {
      if (currentUploadId) {
        uploadManager.unsubscribe(currentUploadId);
      }
    };
  }, [currentUploadId]);

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.android.package-archive', 'application/zip', 'application/octet-stream', '*/*'],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (asset) {
        setFile(asset);
      }
    } catch (e) {
      console.log(e);
      Alert.alert('Ошибка', 'Не удалось выбрать файл');
    }
  };

  const handleUpload = async () => {
    if (!version.trim()) {
      Alert.alert('Ошибка', 'Введите версию (например, 1.2.3)');
      return;
    }
    if (!file) {
      Alert.alert('Ошибка', 'Выберите файл приложения');
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(0);

      // expo-document-picker возвращает uri и name
      const name = file.name || 'app_build';
      // Попытаемся угадать mime по расширению
      let type = 'application/octet-stream';
      if (name.endsWith('.apk')) type = 'application/vnd.android.package-archive';
      else if (name.endsWith('.aab')) type = 'application/octet-stream';
      else if (name.endsWith('.zip')) type = 'application/zip';

      // Используем чанковую загрузку через uploadManager
      const result = await uploadManager.uploadFileResumable(
        file.uri,
        name,
        type,
        'admin_upload', // Контекст загрузки
        (id) => {
          setCurrentUploadId(id);
          uploadManager.subscribe(id, ({ progress, status }) => {
            setUploadProgress(progress);
            if (status === 'error') {
              console.log(`[AdminUpload] Error in upload ${id}`);
            }
          });
        },
        {
          api: adminApi,
          chunkPath: '/admin/upload-app/chunk/'
        }
      );

      if (result && result.status === 'completed') {
        const formData = new FormData();
        formData.append('version', version.trim());
        formData.append('file_path', result.file_path);

        await adminApi.uploadApp(formData);
        Alert.alert('Успех', 'Новая версия загружена');
        navigation.goBack();
      } else {
        throw new Error('Загрузка не была завершена корректно');
      }
    } catch (err) {
      console.log(err);
      const msg = err?.response?.data?.detail || err.message || 'Не удалось загрузить файл';
      Alert.alert('Ошибка', msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}> 
      <Text style={[styles.title, { color: colors.text }]}>Загрузка новой версии приложения</Text>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>Версия</Text>
        <TextInput
          placeholder="например, 1.0.3"
          placeholderTextColor={colors.textSecondary}
          value={version}
          onChangeText={setVersion}
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          autoCapitalize="none"
        />
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>Файл приложения</Text>
        <TouchableOpacity
          onPress={pickFile}
          style={[styles.fileButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Icon name="document-attach-outline" size={20} color={colors.primary} />
          <Text style={[styles.fileButtonText, { color: colors.text }]}>
            {file ? file.name : 'Выбрать файл (.apk, .aab, .zip)'}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        disabled={uploading}
        onPress={handleUpload}
        style={[styles.uploadButton, { backgroundColor: uploading ? colors.border : colors.primary, marginTop: 10 }]}
      >
        {uploading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ActivityIndicator color="#fff" style={{ marginRight: 10 }} />
            <Text style={styles.uploadButtonText}>
              {Math.round(uploadProgress * 100)}%
            </Text>
          </View>
        ) : (
          <Text style={styles.uploadButtonText}>Загрузить</Text>
        )}
      </TouchableOpacity>

      {uploading && (
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
            <View style={[styles.progressFill, { width: `${uploadProgress * 100}%`, backgroundColor: colors.primary }]} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 16 },
  field: { marginBottom: 16 },
  label: { fontSize: 14, marginBottom: 8 },
  input: {
    height: 44,
    borderRadius: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  fileButton: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileButtonText: { marginLeft: 10, fontWeight: '500' },
  uploadButton: {
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadButtonText: { color: '#fff', fontWeight: '700' },
  progressContainer: { marginTop: 16 },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
});