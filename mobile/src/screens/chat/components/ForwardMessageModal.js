import React, { useState } from 'react';
import { View, Text, Modal, FlatList, TouchableOpacity, Image, StyleSheet, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatName, getAvatarUrl } from '../../../utils/formatters';

// Модальное окно выбора чата(ов), в который(е) нужно переслать выделенные сообщения
export default function ForwardMessageModal({ visible, dialogs, colors, onClose, onForward }) {
  const insets = useSafeAreaInsets();
  const [selectedUserIds, setSelectedUserIds] = useState([]);

  const toggleUser = (userId) => {
    setSelectedUserIds(prev => (
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    ));
  };

  const handleClose = () => {
    setSelectedUserIds([]);
    onClose();
  };

  const handleSend = () => {
    if (selectedUserIds.length === 0) return;
    onForward(selectedUserIds);
    setSelectedUserIds([]);
  };

  const renderItem = ({ item }) => {
    const isSelected = selectedUserIds.includes(item.user_id);
    return (
      <TouchableOpacity
        style={[styles.dialogItem, { borderBottomColor: colors.border }]}
        onPress={() => toggleUser(item.user_id)}
      >
        <Image source={{ uri: getAvatarUrl(item.avatar_url) }} style={styles.avatar} />
        <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
          {formatName(item) || 'Пользователь'}
        </Text>
        <MaterialIcons
          name={isSelected ? 'check-circle' : 'radio-button-unchecked'}
          size={24}
          color={isSelected ? colors.primary : colors.textSecondary}
        />
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, {
          borderBottomColor: colors.border,
          paddingTop: (insets.top || (Platform.OS === 'ios' ? 40 : 10)) + 12,
        }]}>
          <TouchableOpacity onPress={handleClose}>
            <MaterialIcons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Переслать сообщение</Text>
          <TouchableOpacity onPress={handleSend} disabled={selectedUserIds.length === 0}>
            <Text style={[styles.sendText, { color: selectedUserIds.length > 0 ? colors.primary : colors.textSecondary }]}>
              Отправить
            </Text>
          </TouchableOpacity>
        </View>
        {dialogs.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={{ color: colors.textSecondary }}>У вас пока нет чатов для пересылки.</Text>
          </View>
        ) : (
          <FlatList
            data={dialogs}
            keyExtractor={(item) => (item.user_id || Math.random()).toString()}
            renderItem={renderItem}
            contentContainerStyle={{ paddingBottom: insets.bottom }}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 16, fontWeight: 'bold' },
  sendText: { fontSize: 16, fontWeight: '600' },
  dialogItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  userName: { flex: 1, fontSize: 16 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
});
