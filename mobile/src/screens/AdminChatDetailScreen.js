import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, Image, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import api from '../api';
import { getFullUrl } from '../utils/urlHelper';
import { formatName } from '../utils/formatters';

export default function AdminChatDetailScreen({ route, navigation }) {
  const { u1, u2 } = route.params;
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const flatListRef = useRef();

  useEffect(() => {
    navigation.setOptions({ title: `${formatName(u1)} & ${formatName(u2)}` });
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/admin/chats/${u1.id}/${u2.id}`);
      setMessages(response.data);
    } catch (error) {
      console.error('Failed to fetch chat history:', error);
      Alert.alert('Ошибка', 'Не удалось загрузить историю переписки');
    } finally {
      setLoading(false);
    }
  };

  const deleteMessage = (messageId) => {
    Alert.alert(
      'Удаление',
      'Вы уверены, что хотите удалить это сообщение навсегда?',
      [
        { text: 'Отмена', style: 'cancel' },
        { 
          text: 'Удалить', 
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/admin/chats/messages/${messageId}`);
              setMessages(messages.filter(m => m.id !== messageId));
            } catch (error) {
              console.error('Failed to delete message:', error);
              Alert.alert('Ошибка', 'Не удалось удалить сообщение');
            }
          }
        }
      ]
    );
  };

  const renderItem = ({ item }) => {
    const isU1 = item.sender_id === u1.id;
    const sender = isU1 ? u1 : u2;

    return (
      <View style={[
        styles.messageWrapper, 
        isU1 ? styles.u1Wrapper : styles.u2Wrapper
      ]}>
        {!isU1 && (
          <Image 
            source={{ uri: getFullUrl(sender.avatar_url) || 'https://via.placeholder.com/150' }} 
            style={styles.smallAvatar} 
          />
        )}
        <View style={[
          styles.messageBubble,
          { backgroundColor: isU1 ? colors.primary : colors.surface, borderColor: colors.border },
          !isU1 && styles.u2Bubble
        ]}>
          <Text style={[styles.messageText, { color: isU1 ? '#fff' : colors.text }]}>
            {item.message}
          </Text>
          <View style={styles.messageFooter}>
            <Text style={[styles.messageTime, { color: isU1 ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>
              {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
            <TouchableOpacity onPress={() => deleteMessage(item.id)} style={styles.deleteBtn}>
              <Icon name="trash-outline" size={14} color={isU1 ? 'rgba(255,255,255,0.7)' : colors.error} />
            </TouchableOpacity>
          </View>
        </View>
        {isU1 && (
          <Image 
            source={{ uri: getFullUrl(sender.avatar_url) || 'https://via.placeholder.com/150' }} 
            style={styles.smallAvatar} 
          />
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 10 },
  messageWrapper: {
    flexDirection: 'row',
    marginBottom: 10,
    alignItems: 'flex-end',
    maxWidth: '85%'
  },
  u1Wrapper: {
    alignSelf: 'flex-end',
    justifyContent: 'flex-end'
  },
  u2Wrapper: {
    alignSelf: 'flex-start'
  },
  smallAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginHorizontal: 5,
    marginBottom: 2
  },
  messageBubble: {
    padding: 10,
    borderRadius: 15,
    borderWidth: 1,
    minWidth: 60
  },
  u2Bubble: {
    borderBottomLeftRadius: 2
  },
  messageText: {
    fontSize: 15
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4
  },
  messageTime: {
    fontSize: 10,
    marginRight: 8
  },
  deleteBtn: {
    padding: 2
  }
});
