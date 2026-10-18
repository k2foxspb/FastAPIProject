import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { aiChatApi } from '../../api/aiChat';
import { useTheme } from '../../context/ThemeContext';
import { theme as themeConstants } from '../../constants/theme';
import MessageBubble from './components/MessageBubble';
import ChatInput from './components/ChatInput';

// Генерация простого уникального id для сообщения в локальном state.
// TODO: когда появится сохранение истории чата в БД, id будут приходить с backend.
let messageIdCounter = 0;
const generateMessageId = () => `${Date.now()}_${messageIdCounter++}`;

// Экран чата с локальным ИИ (Ollama через backend).
// Приложение НИКОГДА не обращается к Ollama напрямую - только к
// backend-эндпоинту POST /api/ai/chat (см. mobile/src/api/aiChat.js).
//
// TODO (на будущее, не ломает текущую архитектуру):
//  - авторизация пользователя (сейчас запрос анонимный, backend публичный);
//  - сохранение истории сообщений в БД на backend и подгрузка её при открытии экрана.
export default function AiChatScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const insets = useSafeAreaInsets();

  // История сообщений хранится в state экрана (пока без персистентности на backend).
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);
  const listRef = useRef(null);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    // Защита от повторной отправки, пока предыдущий запрос ещё выполняется,
    // и от отправки пустого сообщения.
    if (!text || isSending) return;

    const userMessage = { id: generateMessageId(), role: 'user', content: text };
    const historyForRequest = [...messages, userMessage];

    setMessages(historyForRequest);
    setInputText('');
    setError(null);
    setIsSending(true);

    try {
      const response = await aiChatApi.sendMessage(
        historyForRequest.map(({ role, content }) => ({ role, content }))
      );
      const assistantMessage = response?.data?.message;

      if (!assistantMessage?.content) {
        throw new Error('Пустой ответ от сервера');
      }

      setMessages((prev) => [
        ...prev,
        { id: generateMessageId(), role: 'assistant', content: assistantMessage.content },
      ]);
    } catch (e) {
      const serverDetail = e?.response?.data?.detail;
      setError(
        typeof serverDetail === 'string'
          ? serverDetail
          : 'Не удалось получить ответ от ассистента. Проверьте соединение и попробуйте ещё раз.'
      );
    } finally {
      setIsSending(false);
    }
  }, [inputText, isSending, messages]);

  const renderItem = ({ item }) => <MessageBubble message={item} colors={colors} />;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Icon name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>ИИ-ассистент</Text>
        <View style={styles.headerButton} />
      </View>

      {messages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="chatbubble-ellipses-outline" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Задайте вопрос ассистенту - он ответит кратко и по делу
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        />
      )}

      {error && (
        <View style={[styles.errorBanner, { backgroundColor: colors.error }]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <ChatInput
        value={inputText}
        onChangeText={setInputText}
        onSend={handleSend}
        isSending={isSending}
        colors={colors}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerButton: {
    width: 40,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    textAlign: 'center',
  },
  errorBanner: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  errorText: {
    color: '#fff',
    fontSize: 13,
  },
});
