import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { Ionicons as Icon, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { aiChatApi } from '../../api/aiChat';
import { chatApi } from '../../api';
import { useTheme } from '../../context/ThemeContext';
import { useNotifications } from '../../context/NotificationContext';
import { theme as themeConstants } from '../../constants/theme';
import { storage } from '../../utils/storage';
import { AI_ASSISTANT_NAME, AI_ASSISTANT_SUBTITLE, getAiChatHistoryKey } from '../../constants/ai';
import { generateClientId } from '../chat/utils';
import ForwardMessageModal from '../chat/components/ForwardMessageModal';
import MessageBubble from './components/MessageBubble';
import ChatInput from './components/ChatInput';

// Генерация простого уникального id для сообщения в локальном state.
let messageIdCounter = 0;
const generateMessageId = () => `${Date.now()}_${messageIdCounter++}`;

// Экран чата с локальным ИИ-ассистентом (Ollama через backend), под именем "Фокси".
// Приложение НИКОГДА не обращается к Ollama напрямую - только к
// backend-эндпоинту POST /api/ai/chat (см. mobile/src/api/aiChat.js).
// История переписки сохраняется локально на устройстве (AsyncStorage), чтобы не теряться при закрытии экрана.
//
// TODO (на будущее, не ломает текущую архитектуру):
//  - авторизация пользователя на запросе к Ollama (сейчас запрос анонимный, backend публичный);
//  - сохранение истории сообщений на backend вместо локального хранилища (например, для синхронизации между устройствами).
export default function AiChatScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const insets = useSafeAreaInsets();
  const { currentUserId, dialogs, fetchDialogs } = useNotifications();
  const historyKey = getAiChatHistoryKey(currentUserId);

  // История сообщений хранится в state экрана и персистируется в AsyncStorage (см. ниже).
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);
  const [isHistoryLoaded, setHistoryLoaded] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isForwardModalVisible, setForwardModalVisible] = useState(false);
  const listRef = useRef(null);

  // Загрузка сохранённой истории при открытии экрана.
  useEffect(() => {
    let isActive = true;
    (async () => {
      try {
        const raw = await storage.getItem(historyKey);
        if (isActive && raw) {
          setMessages(JSON.parse(raw));
        }
      } catch (e) {
        console.error('[AiChatScreen] Failed to load chat history:', e);
      } finally {
        if (isActive) setHistoryLoaded(true);
      }
    })();
    return () => { isActive = false; };
  }, [historyKey]);

  // Сохраняем историю при каждом изменении сообщений (только после завершения загрузки,
  // чтобы не затереть сохранённую историю пустым начальным state).
  useEffect(() => {
    if (!isHistoryLoaded) return;
    storage.saveItem(historyKey, JSON.stringify(messages)).catch((e) => {
      console.error('[AiChatScreen] Failed to save chat history:', e);
    });
  }, [messages, isHistoryLoaded, historyKey]);

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

  // Выделение сообщений для пересылки (long-press), по аналогии с обычными чатами.
  const toggleSelection = (id) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((x) => x !== id);
        if (next.length === 0) setSelectionMode(false);
        return next;
      }
      return [...prev, id];
    });
  };

  const clearSelection = () => {
    setSelectionMode(false);
    setSelectedIds([]);
  };

  const handlePressMessage = (id) => {
    if (selectionMode) toggleSelection(id);
  };

  const handleLongPressMessage = (id) => {
    if (!selectionMode) {
      setSelectionMode(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    toggleSelection(id);
  };

  const openForwardModal = () => {
    if (selectedIds.length === 0) return;
    setForwardModalVisible(true);
  };

  // Начать новый диалог с ассистентом: очищает историю в state и в AsyncStorage,
  // чтобы не "захламлять" контекст, отправляемый в Ollama при каждом сообщении.
  const handleNewDialog = () => {
    if (messages.length === 0) return;
    Alert.alert(
      'Новый диалог',
      'Начать новый диалог? Текущая история переписки будет удалена.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Начать заново',
          style: 'destructive',
          onPress: () => {
            setMessages([]);
            setError(null);
            clearSelection();
            storage.removeItem(historyKey).catch((e) => {
              console.error('[AiChatScreen] Failed to clear chat history:', e);
            });
          },
        },
      ]
    );
  };

  // Пересылаем выбранные сообщения ассистента как обычные текстовые сообщения в выбранные чаты.
  // У ассистента нет учётной записи пользователя, поэтому вместо служебного поля forwarded_from_id
  // используем текстовую пометку прямо в теле сообщения.
  const handleForward = async (receiverIds) => {
    if (!receiverIds || receiverIds.length === 0 || selectedIds.length === 0) return;

    const messagesToForward = messages.filter((m) => selectedIds.includes(m.id));
    if (messagesToForward.length === 0) return;

    setForwardModalVisible(false);
    clearSelection();

    let hasFailures = false;
    for (const receiverId of receiverIds) {
      for (const message of messagesToForward) {
        try {
          await chatApi.sendMessage({
            receiver_id: receiverId,
            client_id: generateClientId(),
            message_type: 'text',
            message: `Переслано от ${AI_ASSISTANT_NAME}:\n${message.content}`,
          });
        } catch (e) {
          console.error('[AiChatScreen] Failed to forward message:', e);
          hasFailures = true;
        }
      }
    }

    fetchDialogs();

    if (hasFailures) {
      Alert.alert('Внимание', 'Не удалось переслать некоторые сообщения. Проверьте соединение.');
    }
  };

  const renderItem = ({ item }) => (
    <MessageBubble
      message={item}
      colors={colors}
      isSelected={selectedIds.includes(item.id)}
      onPress={() => handlePressMessage(item.id)}
      onLongPress={() => handleLongPressMessage(item.id)}
    />
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => (selectionMode ? clearSelection() : navigation.goBack())}
          style={styles.headerButton}
        >
          <Icon name={selectionMode ? 'close' : 'arrow-back'} size={24} color={colors.text} />
        </TouchableOpacity>
        {selectionMode ? (
          <Text style={[styles.headerTitle, { color: colors.text }]}>Выбрано: {selectedIds.length}</Text>
        ) : (
          <View style={styles.headerTitleBlock}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>{AI_ASSISTANT_NAME}</Text>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{AI_ASSISTANT_SUBTITLE}</Text>
          </View>
        )}
        {selectionMode ? (
          <TouchableOpacity onPress={openForwardModal} style={styles.headerButton}>
            <MaterialIcons name="forward" size={24} color={colors.primary} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={handleNewDialog} style={styles.headerButton}>
            <MaterialIcons name="refresh" size={24} color={colors.text} />
          </TouchableOpacity>
        )}
      </View>

      {messages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="chatbubble-ellipses-outline" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Задайте вопрос ассистенту {AI_ASSISTANT_NAME} - он ответит кратко и по делу
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

      <ForwardMessageModal
        visible={isForwardModalVisible}
        dialogs={dialogs || []}
        colors={colors}
        onClose={() => setForwardModalVisible(false)}
        onForward={handleForward}
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
  headerTitleBlock: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  headerSubtitle: {
    fontSize: 12,
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
