import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform
} from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useNotifications } from '../../context/NotificationContext';
import { useTheme } from '../../context/ThemeContext';
import { theme as themeConstants } from '../../constants/theme';
import { formatMessageTime } from '../../utils/formatters';

// Простой экран группового чата: базовая переписка текстом внутри группы.
// Управление составом группы (добавление/удаление участников, роли) вынесено на GroupInfoScreen.
export default function GroupChatScreen({ route, navigation }) {
  const { groupId, groupName } = route.params;
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const {
    currentUserId, sendGroupMessageWs, getGroupHistoryWs,
    onGroupHistoryReceived, onGroupMessageReceived,
  } = useNotifications();

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef(null);

  useFocusEffect(
    useCallback(() => {
      getGroupHistoryWs(groupId);
    }, [groupId])
  );

  useEffect(() => {
    const unsubHistory = onGroupHistoryReceived((payload) => {
      if (Number(payload.group_id) !== Number(groupId)) return;
      setMessages((payload.data || []).slice().reverse());
    });
    const unsubMessage = onGroupMessageReceived((message) => {
      if (Number(message.group_id) !== Number(groupId)) return;
      setMessages(prev => {
        // Заменяем оптимистичное сообщение (по client_id), если оно уже было добавлено локально
        const existingIndex = message.client_id
          ? prev.findIndex(m => m.client_id === message.client_id)
          : -1;
        if (existingIndex !== -1) {
          const next = [...prev];
          next[existingIndex] = message;
          return next;
        }
        return [...prev, message];
      });
    });
    return () => {
      unsubHistory();
      unsubMessage();
    };
  }, [groupId, onGroupHistoryReceived, onGroupMessageReceived]);

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;
    const clientId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

    sendGroupMessageWs({
      group_id: groupId,
      message: text,
      message_type: 'text',
      client_id: clientId,
    });

    // Оптимистичное добавление своего сообщения в список до ответа сервера
    setMessages(prev => [...prev, {
      id: clientId,
      client_id: clientId,
      sender_id: currentUserId,
      message: text,
      message_type: 'text',
      timestamp: new Date().toISOString(),
    }]);
    setInputText('');
  };

  const renderMessage = ({ item }) => {
    const isMine = Number(item.sender_id) === Number(currentUserId);
    return (
      <View style={[styles.messageWrapper, isMine ? styles.sentWrapper : styles.receivedWrapper]}>
        <View style={[
          styles.bubble,
          { backgroundColor: isMine ? colors.primary : colors.surface }
        ]}>
          {!isMine && item.sender_name && (
            <Text style={[styles.senderName, { color: colors.primary }]}>{item.sender_name}</Text>
          )}
          <Text style={{ color: isMine ? '#fff' : colors.text }}>{item.message}</Text>
          <Text style={[styles.time, { color: isMine ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>
            {formatMessageTime(item.timestamp)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Icon name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          style={{ flex: 1 }}
          onPress={() => navigation.navigate('GroupInfo', { groupId })}
        >
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>{groupName}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('GroupInfo', { groupId })} style={styles.headerButton}>
          <Icon name="people-outline" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderMessage}
        contentContainerStyle={{ padding: 12 }}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.inputBar, { borderTopColor: colors.border, paddingBottom: insets.bottom || 10 }]}>
          <TextInput
            style={[styles.input, { color: colors.text, backgroundColor: colors.surface }]}
            placeholder="Сообщение..."
            placeholderTextColor={colors.textSecondary}
            value={inputText}
            onChangeText={setInputText}
            multiline
          />
          <TouchableOpacity onPress={handleSend} style={[styles.sendButton, { backgroundColor: colors.primary }]}>
            <Icon name="send" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  headerButton: { padding: 8 },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  messageWrapper: { marginVertical: 3, flexDirection: 'row' },
  sentWrapper: { justifyContent: 'flex-end' },
  receivedWrapper: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  senderName: { fontSize: 12, fontWeight: '700', marginBottom: 2 },
  time: { fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxHeight: 100,
    marginRight: 8,
  },
  sendButton: {
    width: 38, height: 38, borderRadius: 19,
    justifyContent: 'center', alignItems: 'center',
  },
});
