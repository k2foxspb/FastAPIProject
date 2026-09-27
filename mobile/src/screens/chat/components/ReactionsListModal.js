import React from 'react';
import { View, Text, Modal, FlatList, TouchableOpacity, Image, StyleSheet, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatName, getAvatarUrl } from '../../../utils/formatters';

// Модальное окно со списком пользователей, поставивших конкретную реакцию на сообщение —
// аватарка, имя и фамилия, переход в профиль по нажатию.
export default function ReactionsListModal({ visible, emoji, reactions, colors, currentUserId, navigation, onClose }) {
  const insets = useSafeAreaInsets();

  const handleUserPress = (userId) => {
    onClose();
    if (userId) {
      navigation?.navigate('UserProfile', { userId });
    }
  };

  const renderItem = ({ item }) => {
    const isMe = Number(item.user_id) === Number(currentUserId);
    return (
      <TouchableOpacity
        style={[styles.userItem, { borderBottomColor: colors.border }]}
        onPress={() => handleUserPress(item.user_id)}
      >
        <Image source={{ uri: getAvatarUrl(item.avatar_preview_url || item.avatar_url) }} style={styles.avatar} />
        <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
          {isMe ? 'Вы' : (formatName(item) || 'Пользователь')}
        </Text>
        <Text style={styles.emoji}>{item.emoji}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity
          activeOpacity={1}
          style={[styles.container, {
            backgroundColor: colors.background,
            marginTop: (insets.top || (Platform.OS === 'ios' ? 40 : 10)) + 60,
          }]}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              {emoji ? `Отреагировали ${emoji}` : 'Отреагировали'}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <MaterialIcons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={reactions}
            keyExtractor={(item, index) => `${item.user_id}_${item.emoji}_${index}`}
            renderItem={renderItem}
            style={{ maxHeight: 320 }}
          />
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  container: {
    marginHorizontal: 20,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 15, fontWeight: 'bold' },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  avatar: { width: 36, height: 36, borderRadius: 18, marginRight: 12 },
  userName: { flex: 1, fontSize: 15 },
  emoji: { fontSize: 18, marginLeft: 8 },
});
