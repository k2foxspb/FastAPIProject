import { useState } from 'react';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { buildForwardMessageData } from '../utils';
import { formatName } from '../../../utils/formatters';

// Режим множественного выделения сообщений: удаление, реакции и пересылка.
// Работает и в личном, и в групповом чате (isGroupChat / canModerate).
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
  isGroupChat = false,
  canModerate = false,
  // Опционально: имя отправителя из сообщения (для групп sender_name уже приходит с бэка)
  resolveSenderName: resolveSenderNameProp,
}) {
  // Надежно вычисляем имя+фамилию отправителя сообщения (не зависит от того,
  // пришло ли сообщение по WS "живьем" (там есть sender_name) или из истории чата (там его нет)).
  const resolveSenderName = (message) => {
    if (typeof resolveSenderNameProp === 'function') {
      return resolveSenderNameProp(message);
    }
    if (message?.sender_name) return message.sender_name;
    if (message?.forwarded_from_name && message?.forwarded_from_id) {
      // не используем как имя текущего отправителя
    }
    if (Number(message.sender_id) === Number(currentUserId)) {
      return formatName(currentUser);
    }
    if (!isGroupChat) {
      return formatName(interlocutor);
    }
    return 'Пользователь';
  };

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
    const canDelete = isGroupChat
      ? (isOwner || canModerate)
      : true;

    if (!canDelete) {
      Alert.alert('Недостаточно прав', 'Вы можете удалять только свои сообщения.');
      return;
    }

    const confirmText = isGroupChat
      ? 'Удалить это сообщение для всех участников группы?'
      : (isOwner
        ? 'Удалить это сообщение для всех участников?'
        : 'Удалить это сообщение для себя? У собеседника оно останется.');

    Alert.alert(
      'Удалить сообщение?',
      confirmText,
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

              setMessages(prev => prev.filter(m => String(m.id) !== String(messageId)));
              if (typeof setSkip === 'function') {
                setSkip(prev => Math.max(0, prev - 1));
              }
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

    const selectedMessages = messages.filter(m => selectedIds.includes(m.id));
    const ownCount = selectedMessages.filter(
      m => Number(m.sender_id) === Number(currentUserId)
    ).length;
    const othersCount = selectedIds.length - ownCount;

    if (isGroupChat && !canModerate && othersCount > 0) {
      Alert.alert(
        'Недостаточно прав',
        'В группе можно удалять только свои сообщения (чужие — только админ/владелец).'
      );
      return;
    }

    let message = `Удалить выбранные сообщения (${selectedIds.length})?`;
    if (isGroupChat) {
      message = `Удалить выбранные сообщения (${selectedIds.length}) для всех участников группы?`;
    } else if (ownCount > 0 && othersCount > 0) {
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
              // В группе без прав модератора отправляем только свои
              const idsToSend = isGroupChat && !canModerate
                ? selectedMessages
                    .filter(m => Number(m.sender_id) === Number(currentUserId))
                    .map(m => m.id)
                : selectedIds;

              if (idsToSend.length === 0) {
                Alert.alert('Недостаточно прав', 'Нет сообщений, которые можно удалить.');
                return;
              }

              const sent = bulkDeleteMessagesWs(idsToSend);
              if (!sent) {
                Alert.alert('Ошибка', 'Не удалось отправить запрос на удаление. Проверьте соединение.');
                return;
              }

              const removedCount = idsToSend.length;
              const idsToDelete = idsToSend.map(id => String(id));
              setMessages(prev => prev.filter(m => !idsToDelete.includes(String(m.id))));
              if (typeof setSkip === 'function') {
                setSkip(prev => Math.max(0, prev - removedCount));
              }

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
