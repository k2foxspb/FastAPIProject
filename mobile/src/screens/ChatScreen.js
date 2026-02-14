import React, { useState, useEffect, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { chatApi } from '../api';
import { API_BASE_URL } from '../constants';
import { storage } from '../utils/storage';
import { useNotifications } from '../context/NotificationContext';

export default function ChatScreen({ route }) {
  const { userId, userName } = route.params;
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [token, setToken] = useState(null);
  const ws = useRef(null);
  const { fetchDialogs } = useNotifications();

  useEffect(() => {
    const initChat = async () => {
      const accessToken = await storage.getAccessToken();
      setToken(accessToken);

      // Загрузка истории
      chatApi.getHistory(userId, accessToken).then(res => setMessages(res.data));

      // Помечаем как прочитанные
      chatApi.markAsRead(userId, accessToken).then(() => fetchDialogs());

      // WebSocket соединение
      const wsUrl = `ws://${API_BASE_URL.replace('http://', '').replace('https://', '')}/chat/ws/${accessToken}`;
      ws.current = new WebSocket(wsUrl);

      ws.current.onmessage = (e) => {
        const message = JSON.parse(e.data);
        if (message.sender_id === userId || (message.sender_id !== userId && message.receiver_id === userId)) {
          // Если мы в этом чате, то сообщение от собеседника или наше подтверждение
          setMessages(prev => {
            if (prev.find(m => m.id === message.id)) return prev;
            return [...prev, message];
          });
          
          // Если сообщение от собеседника, помечаем как прочитанное
          if (message.sender_id === userId) {
            chatApi.markAsRead(userId, accessToken).then(() => fetchDialogs());
          }
        }
      };
    };

    initChat();

    return () => {
      if (ws.current) ws.current.close();
    };
  }, [userId]);

  const sendMessage = () => {
    if (inputText.trim()) {
      const msgData = {
        receiver_id: userId,
        message: inputText,
        message_type: 'text'
      };
      ws.current.send(JSON.stringify(msgData));
      setInputText('');
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={styles.container}
      keyboardVerticalOffset={90}
    >
      <FlatList
        data={messages}
        keyExtractor={(item) => (item.id || Math.random()).toString()}
        renderItem={({ item }) => (
          <View style={[
            styles.messageBubble, 
            item.sender_id === userId ? styles.received : styles.sent
          ]}>
            <Text style={styles.messageText}>{item.message}</Text>
          </View>
        )}
      />
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Сообщение..."
        />
        <TouchableOpacity onPress={sendMessage} style={styles.sendButton}>
          <Text style={styles.sendButtonText}>Отправить</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  messageBubble: { padding: 10, borderRadius: 10, margin: 5, maxWidth: '80%' },
  sent: { alignSelf: 'flex-end', backgroundColor: '#007AFF' },
  received: { alignSelf: 'flex-start', backgroundColor: '#E5E5EA' },
  messageText: { color: '#fff' },
  inputContainer: { flexDirection: 'row', padding: 10, backgroundColor: '#fff' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingHorizontal: 15, height: 40 },
  sendButton: { justifyContent: 'center', marginLeft: 10 },
  sendButtonText: { color: '#007AFF', fontWeight: 'bold' },
});
