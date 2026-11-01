import React, { useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, Image, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useColors } from './common';
import { useJournalQuery } from '../../context/JournalContext';
import { addAttachment, deleteAttachment, listAttachments } from '../../journal/db/repos/attachments';
import { journalAttachmentUrl } from '../../api/journal';
import { storage } from '../../utils/storage';

// Миниатюра: локальная копия (если есть) или файл с сервера с токеном (отдаётся только владельцу).
export const AttachmentThumb = ({ attachment, token, size = 72, onLongPress, onPress }) => {
  const colors = useColors();
  const source = attachment.local_uri
    ? { uri: attachment.local_uri }
    : (token ? { uri: journalAttachmentUrl(attachment.uuid), headers: { Authorization: `Bearer ${token}` } } : null);
  return (
    <TouchableOpacity onLongPress={onLongPress} onPress={onPress} style={[styles.thumb, { width: size, height: size, backgroundColor: colors.border }]}>
      {source && <Image source={source} style={{ width: size, height: size, borderRadius: 8 }} />}
      {attachment.upload_state === 'pending' && (
        <View style={styles.badge}><Icon name="cloud-upload-outline" size={12} color="#fff" /></View>
      )}
      {attachment.upload_state === 'failed' && (
        <View style={[styles.badge, { backgroundColor: colors.error }]}><Icon name="alert" size={12} color="#fff" /></View>
      )}
    </TouchableOpacity>
  );
};

export const useAuthToken = () => {
  const [token, setToken] = useState(null);
  useEffect(() => {
    storage.getAccessToken().then(setToken);
  }, []);
  return token;
};

const pick = async (fromCamera) => {
  const perm = fromCamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Нет доступа', fromCamera ? 'Разрешите доступ к камере в настройках' : 'Разрешите доступ к фото в настройках');
    return null;
  }
  const options = { mediaTypes: ['images'], quality: 0.8, exif: false };
  const result = fromCamera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return null;
  return result.assets[0];
};

export default function AttachmentStrip({ ownerType, ownerUuid, editable = true }) {
  const colors = useColors();
  const token = useAuthToken();
  const { data: items } = useJournalQuery(() => listAttachments(ownerUuid), [ownerUuid]);

  const add = async (fromCamera) => {
    try {
      const asset = await pick(fromCamera);
      if (asset) await addAttachment(ownerType, ownerUuid, asset);
    } catch (e) {
      Alert.alert('Не удалось добавить фото', e?.message || 'Попробуйте ещё раз');
    }
  };

  const chooseSource = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Отмена', 'Сделать фото', 'Выбрать из галереи'], cancelButtonIndex: 0 },
        (i) => { if (i === 1) add(true); if (i === 2) add(false); },
      );
    } else {
      Alert.alert('Добавить фото', null, [
        { text: 'Камера', onPress: () => add(true) },
        { text: 'Галерея', onPress: () => add(false) },
        { text: 'Отмена', style: 'cancel' },
      ]);
    }
  };

  const confirmDelete = (att) => {
    if (!editable) return;
    Alert.alert('Удалить фото?', null, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => deleteAttachment(att.uuid) },
    ]);
  };

  if (!editable && !items?.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {(items || []).map((att) => (
        <AttachmentThumb key={att.uuid} attachment={att} token={token} onLongPress={() => confirmDelete(att)} />
      ))}
      {editable && (
        <TouchableOpacity style={[styles.add, { borderColor: colors.border }]} onPress={chooseSource}>
          <Icon name="camera-outline" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 4, alignItems: 'center' },
  thumb: { borderRadius: 8, marginRight: 8, overflow: 'hidden' },
  add: { width: 72, height: 72, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: 4, bottom: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: 2 },
});
