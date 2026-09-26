import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, Animated, ActivityIndicator } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { MaterialIcons } from '@expo/vector-icons';
import CachedMedia from '../../../components/CachedMedia';
import VoiceMessage from '../../../components/VoiceMessage';
import FileMessage from '../../../components/FileMessage';
import VideoNoteMessage from '../../../components/VideoNoteMessage';
import { formatFileSize, parseISODate, formatMessageTime, formatDateSeparator } from '../../../utils/formatters';
import { styles } from '../styles';
import { resolveMediaUri, getReplyPreviewText } from '../utils';
import MediaPlaceholder from './MediaPlaceholder';
import MessageText from './MessageText';
import ReactionBar from './ReactionBar';
import ReactionsListModal from './ReactionsListModal';

// Одно сообщение в списке чата (текст, медиа, медиа-группа, голосовое, видео-кружок, файл, плейсхолдер загрузки)
export default function MessageItem({
  item,
  prevMsg,
  userId,
  currentUserId,
  colors,
  selectionMode,
  isSelected,
  isCurrentSearchResult,
  isReplyHighlighted,
  isParentVisible,
  uploadingProgress,
  uploadingData,
  searchQuery,
  isSearching,
  onPress,
  onLongPress,
  onReply,
  onOpenFullScreen,
  onScrollToMessage,
  navigation,
  showReactionBar,
  onReact,
  isGroupChat = false,
}) {
  const [reactionsModalEmoji, setReactionsModalEmoji] = useState(null);
  const isImage = item.message_type === 'image';
  const isVideo = item.message_type === 'video';
  const isVoice = item.message_type === 'voice';
  const isAudio = item.message_type === 'audio';
  const isVideoNote = item.message_type === 'video_note';
  const isFile = item.message_type === 'file';
  const isMediaGroup = item.message_type === 'media_group';
  const isMedia = isImage || isVideo || isVoice || isAudio || isVideoNote || isMediaGroup || isFile;
  const isOwner = Number(item.sender_id) === Number(currentUserId);
  // В личном чате входящие — от собеседника (userId); в группе — всё, что не от нас
  const isReceived = isGroupChat
    ? !isOwner
    : Number(item.sender_id) === Number(userId);

  // Входящий (и исходящий) плейсхолдер загрузки для собеседника
  if (item?.is_uploading && !item?.file_path) {
    // Скрываем дубликат плейсхолдера для отправителя, если у него есть локальный индикатор
    if (!isReceived && uploadingProgress !== null) return null;

    const progressPercent = Math.round(((item.upload_progress || 0) * 100));
    const progressText = (item.upload_offset !== undefined && item.upload_total !== undefined && item.upload_total > 0)
      ? `${formatFileSize(item.upload_offset)} / ${formatFileSize(item.upload_total)}`
      : (progressPercent > 0 ? `${progressPercent}%` : '');

    return (
      <View style={[styles.messageWrapper, isReceived ? styles.receivedWrapper : styles.sentWrapper]}>
        <View style={[
          styles.messageBubble, 
          isReceived 
            ? [styles.received, { backgroundColor: isVideoNote ? 'transparent' : colors.surface }] 
            : [styles.sent, { backgroundColor: isVideoNote ? 'transparent' : colors.primary }],
          { padding: isVideoNote ? 0 : 4, alignItems: isVideoNote ? 'center' : 'stretch' }
        ]}> 
          {/* Рендерим плейсхолдеры для медиа в процессе загрузки */}
          {isMediaGroup && item.attachments && item.attachments.map((att, idx) => (
            <View key={`upload_att_${idx}`} style={{ marginBottom: 4 }}>
              <MediaPlaceholder type={att.type} isReceived={isReceived} uri={att.file_path || (isOwner ? uploadingData.uri : null)} colors={colors} />
            </View>
          ))}
          {!isMediaGroup && isMedia && (
            <MediaPlaceholder type={item.message_type} isReceived={isReceived} uri={item.file_path || (isOwner ? uploadingData.uri : null)} colors={colors} />
          )}
          
          <View style={{ 
              flexDirection: 'row', 
              alignItems: 'center', 
              padding: 8,
              backgroundColor: isVideoNote ? 'rgba(0,0,0,0.5)' : 'transparent',
              borderRadius: isVideoNote ? 20 : 0,
              marginTop: isVideoNote ? -40 : 0,
              marginBottom: isVideoNote ? 10 : 0
          }}>
            <ActivityIndicator size="small" color={isReceived && !isVideoNote ? colors.text : '#fff'} />
            <Text style={[styles.messageText, (isReceived && !isVideoNote) ? { color: colors.text } : { color: '#fff' }, { marginLeft: 8, fontSize: 12 }]}>
              {progressPercent >= 100 ? "Обработка..." : (isVideoNote ? (progressPercent > 0 ? `${progressPercent}%` : "Загрузка...") : "Загрузка... " + progressText)}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // Группировка: если предыдущее сообщение от того же отправителя и разница во времени менее 2 минут
  // (prevMsg — это messages[index + 1], т.к. FlatList inverted)
  const currentMsgDate = parseISODate(item.timestamp);
  const prevMsgDate = prevMsg ? parseISODate(prevMsg.timestamp) : null;
  
  const isGrouped = prevMsg && Number(prevMsg.sender_id) === Number(item.sender_id) && 
                    currentMsgDate && prevMsgDate && (currentMsgDate - prevMsgDate) < 120000;

  // Разделитель дат: показываем над сообщением, если это первое сообщение своего дня
  // (prevMsg — это messages[index + 1], т.е. хронологически более старое сообщение,
  // отображаемое выше текущего, т.к. FlatList инвертирован)
  const showDateSeparator = currentMsgDate && (
    !prevMsgDate ||
    currentMsgDate.getFullYear() !== prevMsgDate.getFullYear() ||
    currentMsgDate.getMonth() !== prevMsgDate.getMonth() ||
    currentMsgDate.getDate() !== prevMsgDate.getDate()
  );

  // Группируем реакции по эмодзи: [{ emoji, count, isMine }]
  const groupedReactions = (item.reactions && item.reactions.length > 0)
    ? Object.values(item.reactions.reduce((acc, r) => {
        if (!acc[r.emoji]) acc[r.emoji] = { emoji: r.emoji, count: 0, isMine: false };
        acc[r.emoji].count += 1;
        if (Number(r.user_id) === Number(currentUserId)) acc[r.emoji].isMine = true;
        return acc;
      }, {}))
    : [];

  const handleFullScreen = (uri, type) => {
    if (selectionMode) {
      onPress(item.id);
      return;
    }
    onOpenFullScreen(uri, type);
  };

  const renderLeftActions = (progress, dragX) => {
    const scale = dragX.interpolate({
      inputRange: [0, 50, 80],
      outputRange: [0, 0.8, 1.2],
      extrapolate: 'clamp',
    });
    return (
      <View style={{ width: 80, justifyContent: 'center', alignItems: 'center' }}>
        <Animated.View style={{ transform: [{ scale }] }}>
          <MaterialIcons name="reply" size={24} color={colors.primary} />
        </Animated.View>
      </View>
    );
  };

  return (
    <>
      {showDateSeparator && (
        <View style={styles.dateSeparatorWrapper}>
          <View style={[styles.dateSeparatorBubble, { backgroundColor: colors.surface }]}>
            <Text style={[styles.dateSeparatorText, { color: colors.textSecondary }]}>
              {formatDateSeparator(currentMsgDate)}
            </Text>
          </View>
        </View>
      )}
      {showReactionBar && (
        <View style={[styles.messageWrapper, isReceived ? styles.receivedWrapper : styles.sentWrapper]}>
          <ReactionBar colors={colors} onSelect={(emoji) => onReact(item.id, emoji)} />
        </View>
      )}
    <Swipeable
      renderLeftActions={renderLeftActions}
      onSwipeableOpen={(direction, swipeable) => {
        if (direction === 'left') {
          onReply(item);
          setTimeout(() => {
            swipeable?.close();
          }, 0);
        }
      }}
      leftThreshold={50}
      friction={2}
    >
      <Pressable 
        onPress={() => onPress(item.id)}
        onLongPress={() => onLongPress(item.id)}
        style={[
          styles.messageWrapper,
          isReceived ? styles.receivedWrapper : styles.sentWrapper,
            (isSelected || isCurrentSearchResult || isReplyHighlighted) && { 
              backgroundColor: isCurrentSearchResult 
                ? colors.primary + '30' 
                : (isReplyHighlighted ? colors.primary + '15' : colors.primary + '20') 
            },
            isGrouped && { marginTop: -2 },
            { zIndex: (isCurrentSearchResult || isReplyHighlighted) ? 10 : 1 }
          ]}
        >
          <View 
            style={[
              styles.messageBubble, 
              isReceived 
                ? [styles.received, { backgroundColor: colors.surface }] 
                : [styles.sent, { backgroundColor: colors.primary }],
              (isImage || isVideo) && !item.message && { padding: 4, overflow: 'hidden' },
              isVideoNote && { padding: 0, backgroundColor: 'transparent', elevation: 0, shadowOpacity: 0 },
              isSelected && !isReceived && { opacity: 0.8 },
              (isCurrentSearchResult || isReplyHighlighted) && { 
                borderWidth: 1.5, 
                borderColor: colors.primary, 
                shadowColor: colors.primary,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.3,
                shadowRadius: 4,
                elevation: 3
              },
              { zIndex: (isCurrentSearchResult || isReplyHighlighted) ? 11 : 2 },
              isGrouped && (isReceived ? { borderTopLeftRadius: 18 } : { borderTopRightRadius: 18 })
            ]}
          >
        {isGroupChat && isReceived && !isGrouped && !!item.sender_name && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => item.sender_id && navigation?.navigate('UserProfile', { userId: item.sender_id })}
            style={{ marginBottom: 2 }}
          >
            <Text style={[styles.replyMessageSender, { color: colors.primary }]} numberOfLines={1}>
              {item.sender_name}
            </Text>
          </TouchableOpacity>
        )}
        {item.forwarded_from_id && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => navigation?.navigate('UserProfile', { userId: item.forwarded_from_id })}
            style={styles.forwardedLabelContainer}
          >
            <MaterialIcons name="forward" size={14} color={isReceived ? colors.primary : '#fff'} />
            <Text style={[styles.forwardedLabelText, { color: isReceived ? colors.primary : '#fff' }]} numberOfLines={1}>
              Переслано от {Number(item.forwarded_from_id) === Number(currentUserId) ? 'Вас' : (item.forwarded_from_name || 'Пользователь')}
            </Text>
          </TouchableOpacity>
        )}
        {item.reply_to && (
          <TouchableOpacity 
            activeOpacity={0.7}
            onPress={() => onScrollToMessage(item.reply_to.id)}
            style={[
              styles.replyMessageContainer, 
              { borderLeftColor: isReceived ? colors.primary : '#fff', backgroundColor: isReceived ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.1)' }
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
              <MaterialIcons name="reply" size={12} color={isReceived ? colors.primary : '#fff'} style={{ marginRight: 4 }} />
              <Text style={[styles.replyMessageSender, { color: isReceived ? colors.primary : '#fff' }]} numberOfLines={1}>
                {Number(item.reply_to.sender_id) === Number(currentUserId) ? 'Вы' : (item.reply_to.sender_name || 'Собеседник')}
              </Text>
            </View>
            <Text style={[styles.replyMessageText, { color: isReceived ? colors.textSecondary : 'rgba(255,255,255,0.8)' }]} numberOfLines={1}>
              {getReplyPreviewText(item.reply_to)}
            </Text>
          </TouchableOpacity>
        )}
        {selectionMode && (
          <View style={styles.selectionIndicator}>
            <MaterialIcons 
              name={isSelected ? "check-circle" : "radio-button-unchecked"} 
              size={16} 
              color={isReceived ? (isSelected ? colors.primary : colors.textSecondary) : "#fff"} 
            />
          </View>
        )}
        {/* Медиа-группа */}
        {item.attachments && item.attachments.length > 0 ? (
          <View style={styles.mediaGridContainer}>
            <View style={styles.mediaGrid}>
              {item.attachments.map((att, idx) => {
                if (att.type === 'video_note') return null;
                const attUri = att.file_path ? resolveMediaUri(att.file_path) : null;
                
                // Расчет размеров для сетки
                const count = item.attachments.filter(a => a.type !== 'video_note').length;
                let itemWidth = '100%';
                let itemHeight = 200;
                
                if (count === 2) {
                  itemWidth = '49%';
                  itemHeight = 150;
                } else if (count === 3) {
                  if (idx === 0) {
                    itemWidth = '100%';
                    itemHeight = 150;
                  } else {
                    itemWidth = '49%';
                    itemHeight = 100;
                  }
                } else if (count >= 4) {
                  itemWidth = '49%';
                  itemHeight = 100;
                }

                if (!attUri) {
                  return (
                    <View key={`${item.id}_att_${idx}`} style={{ width: itemWidth, height: itemHeight, marginBottom: 4 }}>
                      <MediaPlaceholder type={att.type} isReceived={isReceived} uri={att.file_path} colors={colors} />
                    </View>
                  );
                }

                return (
                  <Pressable 
                    key={`${item.id}_att_${idx}`}
                    onPress={() => handleFullScreen(attUri, att.type)}
                    style={{ 
                      width: itemWidth, 
                      height: itemHeight, 
                      borderRadius: 8, 
                      marginBottom: 4,
                      overflow: 'hidden'
                    }}
                  >
                    <CachedMedia 
                      item={{ ...att, message_type: att.type }} 
                      style={{ width: '100%', height: '100%' }}
                      onFullScreen={() => handleFullScreen(attUri, att.type)}
                      shouldPlay={false}
                      isStatic={true}
                      isParentVisible={isParentVisible}
                    />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : (
          (isImage || isVideo) && (
            item.file_path || item.uri ? (
              <View style={{ borderRadius: 12, overflow: 'hidden' }}>
                <CachedMedia 
                  item={item} 
                  onFullScreen={handleFullScreen} 
                  style={{ borderRadius: 12, overflow: 'hidden' }}
                  shouldPlay={false}
                  isStatic={true}
                  isParentVisible={isParentVisible}
                />
              </View>
            ) : <MediaPlaceholder type={item.message_type} isReceived={isReceived} uri={item.file_path} colors={colors} />
          )
        )}
        {isVoice && (
          item.file_path || item.uri ? (
            <VoiceMessage 
              item={item} 
              currentUserId={currentUserId} 
              isParentVisible={isParentVisible}
            />
          ) : <MediaPlaceholder type={item.message_type} isReceived={isReceived} uri={item.file_path} colors={colors} />
        )}
        {isVideoNote && (
          item.file_path || item.video_url || item.uri ? (
            <VideoNoteMessage 
              item={item} 
              isReceived={isReceived} 
              isParentVisible={isParentVisible}
            />
          ) : <MediaPlaceholder type={item.message_type} isReceived={isReceived} uri={item.file_path} colors={colors} />
        )}
        {item.attachments && item.attachments.some(att => att.type === 'video_note') && !isVideoNote && (
          item.attachments.filter(att => att.type === 'video_note').map((att, idx) => (
            <VideoNoteMessage 
              key={`att_vn_${idx}`}
              item={att} 
              isReceived={isReceived} 
              isParentVisible={isParentVisible}
            />
          ))
        )}
        {isFile && (
          <View style={{ alignSelf: isReceived ? 'flex-start' : 'flex-end', minWidth: 220 }}>
            <FileMessage item={item} currentUserId={currentUserId} />
          </View>
        )}
        {item.message && (
          <View style={[
            (isImage || isVideo) && { marginTop: 5, marginHorizontal: 8, marginBottom: 4 }
          ]}>
            <MessageText
              message={item.message}
              isReceived={isReceived}
              searchQuery={searchQuery}
              isSearching={isSearching}
              colors={colors}
            />
          </View>
        )}
        {/* Комментарий, добавленный при пересылке — показываем в том же пузыре, что и пересланное сообщение */}
        {item.forwarded_from_id && item.comment && (
          <View style={[
            styles.forwardedCommentContainer,
            { borderTopColor: isReceived ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.2)' }
          ]}>
            <MessageText
              message={item.comment}
              isReceived={isReceived}
              searchQuery={searchQuery}
              isSearching={isSearching}
              colors={colors}
            />
          </View>
        )}
        {groupedReactions.length > 0 && (
          <View style={styles.reactionsRow}>
            {groupedReactions.map(({ emoji, count, isMine }) => (
              <TouchableOpacity
                key={emoji}
                activeOpacity={0.7}
                onPress={() => onReact(item.id, emoji)}
                onLongPress={() => setReactionsModalEmoji(emoji)}
                style={[
                  styles.reactionBadge,
                  {
                    backgroundColor: isMine ? colors.primary + '30' : (isReceived ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.15)'),
                    borderWidth: isMine ? 1 : 0,
                    borderColor: colors.primary,
                  }
                ]}
              >
                <Text style={styles.reactionBadgeEmoji}>{emoji}</Text>
                {count > 1 && (
                  <Text style={[styles.reactionBadgeCount, { color: isReceived ? colors.textSecondary : 'rgba(255,255,255,0.9)' }]}>
                    {count}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={styles.messageFooter}>
          <Text style={[
            styles.messageTime, 
            isReceived ? {color: colors.textSecondary} : {color: 'rgba(255,255,255,0.7)'}
          ]}>
            {formatMessageTime(item.timestamp)}
          </Text>
          {!isReceived && (
            <MaterialIcons 
              name={
                item.status === 'pending' ? "schedule" : 
                item.is_read ? "done-all" : "done"
              } 
              size={14} 
              color={
                item.status === 'pending' ? "rgba(255,255,255,0.5)" :
                item.is_read ? "#4CAF50" : "rgba(255,255,255,0.7)"
              } 
              style={styles.statusIcon}
            />
          )}
        </View>
      </View>
    </Pressable>
  </Swipeable>
      <ReactionsListModal
        visible={!!reactionsModalEmoji}
        emoji={reactionsModalEmoji}
        reactions={(item.reactions || []).filter(r => r.emoji === reactionsModalEmoji)}
        colors={colors}
        currentUserId={currentUserId}
        navigation={navigation}
        onClose={() => setReactionsModalEmoji(null)}
      />
    </>
  );
}
