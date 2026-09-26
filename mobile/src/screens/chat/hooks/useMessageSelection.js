import { useState } from 'react';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { buildForwardMessageData } from '../utils';
import { formatName } from '../../../utils/formatters';

// Режим множественного выделения сообщений: удаление и пересылка в другие чаты
export default function useMessageSelection({
  messages,
  setMessages,
  setSkip,
  userId,
  currentUserId,
  currentUser,
  interlocutor,
  dialogs,
  navigation,
  deleteMessageWs,
  bulkDeleteMessagesWs,
  sendMessageWs,
  toggleReactionWs,
}) {
  // Надежно вычисляем имя+фамилию отправителя сообщения (не зависит от того,
  // пришло ли сообщение по WS "живьем" (там есть sender_name) или из истории чата (там его нет)).
  const resolveSenderName = (message) => (
    Number(message.sender_id) === Number(currentUserId)
      ? formatName(currentUser)
      : formatName(interlocutor)
  );
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isForwardModalVisible, setForwardModalVisible] = useState(false);

  const toggleSelection = (id) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) {
        const next = prev.filter(x => x !== id);
        if (next.length === 0) setSelectionMode(false);
        return next;
      } else {
        return [...prev, id];
      }
    });
  };

  const clearSelection = () => {
    setSelectionMode(false);
    setSelectedIds([]);
  };

  const handlePressMessage = (id) => {
    if (selectionMode) {
      toggleSelection(id);
    }
  };

  const handleLongPressMessage = (id) => {
    if (!selectionMode) {
      setSelectionMode(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    toggleSelection(id);
  };

  const handleDeleteMessage = (messageId) => {
    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    const isOwner = Number(message.sender_id) === Number(currentUserId);
    
    Alert.alert(
      'Удалить сообщение?',
      isOwner 
        ? 'Удалить это сообщение для всех участников?' 
        : 'Удалить это сообщение для себя? У собеседника оно останется.',
      [
        { text: 'Отмена', style: 'cancel' },
        { 
          text: 'Удалить', 
          style: 'destructive', 
          onPress: async () => {
            try {
              const sent = deleteMessageWs(messageId);
              if (!sent) {
                Alert.alert('Ошибка', 'Не удалось отправить запрос на удаление. Проверьте соединение.');
                return;
              }

              // Локально обновляем список сообщений
              setMessages(prev => prev.filter(m => String(m.id) !== String(messageId)));
              setSkip(prev => Math.max(0, prev - 1));
            } catch (error) {
              console.error('Failed to delete message', error);
              Alert.alert('Ошибка', 'Не удалось удалить сообщение');
            }
          }
        }
      ]
    );
  };

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    
    const ownCount = messages.filter(m => selectedIds.includes(m.id) && m.sender_id !== userId).length;
    const othersCount = selectedIds.length - ownCount;
    
    let message = `Удалить выбранные сообщения (${selectedIds.length})?`;
    if (ownCount > 0 && othersCount > 0) {
      message = `Удалить ${selectedIds.length} сообщений? Ваши сообщения (${ownCount}) удалятся у всех, а чужие (${othersCount}) — только у вас.`;
    } else if (ownCount > 0) {
      message = `Удалить ваши сообщения (${ownCount}) для всех участников?`;
    } else {
      message = `Удалить чужие сообщения (${othersCount}) для себя? У собеседника они останутся.`;
    }

    Alert.alert(
      'Удалить сообщения?',
      message,
      [
        { text: 'Отмена', style: 'cancel' },
        { 
          text: 'Удалить', 
          style: 'destructive', 
          onPress: async () => {
            try {
              const sent = bulkDeleteMessagesWs(selectedIds);
              if (!sent) {
                Alert.alert('Ошибка', 'Не удалось отправить запрос на удаление. Проверьте соединение.');
                return;
              }

              // Локально обновляем список сообщений, чтобы чат сразу отразил удаление
              const removedCount = selectedIds.length;
              const idsToDelete = selectedIds.map(id => String(id));
              setMessages(prev => prev.filter(m => !idsToDelete.includes(String(m.id))));
              setSkip(prev => Math.max(0, prev - removedCount));

              setSelectionMode(false);
              setSelectedIds([]);
            } catch (error) {
              console.error('Failed to bulk delete messages', error);
              Alert.alert('Ошибка', 'Не удалось удалить сообщения');
            }
          }
        }
      ]
    );
  };

  // Реакция смайликом на одно сообщение (панель показывается над сообщением при его выделении)
  const handleReact = (messageId, emoji) => {
    if (!messageId || !emoji) return;

    // Оптимистично обновляем локальный список реакций до ответа сервера
    setMessages(prev => prev.map(m => {
      if (String(m.id) !== String(messageId)) return m;
      const prevReactions = m.reactions || [];
      const myExisting = prevReactions.find(r => Number(r.user_id) === Number(currentUserId));
      let nextReactions;
      if (myExisting && myExisting.emoji === emoji) {
        nextReactions = prevReactions.filter(r => Number(r.user_id) !== Number(currentUserId));
      } else if (myExisting) {
        nextReactions = prevReactions.map(r => (
          Number(r.user_id) === Number(currentUserId) ? { ...r, emoji } : r
        ));
      } else {
        nextReactions = [...prevReactions, { emoji, user_id: currentUserId }];
      }
      return { ...m, reactions: nextReactions };
    }));

    const sent = toggleReactionWs(messageId, emoji);
    if (!sent) {
      Alert.alert('Ошибка', 'Не удалось отправить реакцию. Проверьте соединение.');
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    clearSelection();
  };

  const openForwardModal = () => {
    if (selectedIds.length === 0) return;
    setForwardModalVisible(true);
  };

  const closeForwardModal = () => {
    setForwardModalVisible(false);
  };

  const handleForward = (receiverIds) => {
    if (!receiverIds || receiverIds.length === 0 || selectedIds.length === 0) return;

    // Пересылаем в хронологическом порядке (messages идут от новых к старым, т.к. FlatList inverted)
    const messagesToForward = messages
      .filter(m => selectedIds.includes(m.id))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    if (messagesToForward.length === 0) return;

    setForwardModalVisible(false);

    // Если выбран ровно один собеседник — не отправляем сразу, а переходим в чат к нему,
    // показывая пересылаемые сообщения превью над полем ввода, куда можно дописать комментарий.
    if (receiverIds.length === 1) {
      const receiverId = receiverIds[0];
      const forwardMessagesData = messagesToForward.map(message => (
        buildForwardMessageData(message, receiverId, resolveSenderName(message))
      ));
      clearSelection();

      const targetDialog = (dialogs || []).find(d => Number(d.user_id) === Number(receiverId));
      const targetUserName = targetDialog ? formatName(targetDialog) : undefined;

      navigation.navigate('Chat', {
        userId: receiverId,
        userName: targetUserName,
        pendingForwardMessages: forwardMessagesData,
      });
      return;
    }

    // Несколько получателей — общий комментарий не имеет смысла, отправляем сразу всем.
    let hasFailures = false;
    receiverIds.forEach(receiverId => {
      messagesToForward.forEach(message => {
        const msgData = buildForwardMessageData(message, receiverId, resolveSenderName(message));
        const sent = sendMessageWs(msgData);
        if (!sent) hasFailures = true;
      });
    });

    clearSelection();

    if (hasFailures) {
      Alert.alert('Внимание', 'Некоторые сообщения будут отправлены позже, когда восстановится соединение.');
    }
  };

  return {
    selectionMode,
    selectedIds,
    toggleSelection,
    clearSelection,
    handlePressMessage,
    handleLongPressMessage,
    handleDeleteMessage,
    handleBulkDelete,
    handleReact,
    isForwardModalVisible,
    openForwardModal,
    closeForwardModal,
    handleForward,
  };
}
