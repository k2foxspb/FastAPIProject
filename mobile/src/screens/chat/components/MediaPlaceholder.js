import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

// Плейсхолдер медиа (фото/видео/голос/файл), пока файл ещё не загружен
export default function MediaPlaceholder({ type, isReceived, uri = null, colors }) {
  let iconName = 'insert-drive-file';
  let label = 'Файл';
  
  if (type === 'image') { iconName = 'image'; label = 'Фотография'; }
  else if (type === 'video') { iconName = 'videocam'; label = 'Видео'; }
  else if (type === 'voice' || type === 'audio') { iconName = 'mic'; label = 'Голосовое сообщение'; }
  else if (type === 'video_note') { iconName = 'play-circle-outline'; label = 'Видео-сообщение'; }
  
  const isVisual = type === 'image' || type === 'video' || type === 'video_note';
  const isVideoNote = type === 'video_note';

  if (isVisual) {
      return (
          <View style={{
              width: isVideoNote ? 160 : 200,
              height: isVideoNote ? 160 : 150,
              borderRadius: isVideoNote ? 80 : 12,
              backgroundColor: isReceived ? colors.border + '44' : 'rgba(255,255,255,0.1)',
              justifyContent: 'center',
              alignItems: 'center',
              overflow: 'hidden',
              margin: 4,
              borderWidth: 1,
              borderColor: isReceived ? colors.border : 'rgba(255,255,255,0.2)'
          }}>
              {uri ? (
                  <Image 
                      source={{ uri }} 
                      style={StyleSheet.absoluteFill} 
                      resizeMode="cover"
                  />
              ) : (
                  <View style={{ position: 'absolute', opacity: 0.2 }}>
                       <MaterialIcons name={iconName} size={isVideoNote ? 100 : 80} color={isReceived ? colors.textSecondary : '#fff'} />
                  </View>
              )}
              {!isVideoNote && (
                  <View style={{
                      backgroundColor: 'rgba(0,0,0,0.4)',
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 15,
                      flexDirection: 'row',
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.2)'
                  }}>
                      <MaterialIcons name={iconName} size={16} color="#fff" />
                      <Text style={{ color: '#fff', fontSize: 11, marginLeft: 4, fontWeight: '500' }}>{label}</Text>
                  </View>
              )}
          </View>
      );
  }

  return (
    <View style={{ 
        backgroundColor: isReceived ? colors.border + '44' : 'rgba(255,255,255,0.1)',
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 12,
        minWidth: 150,
        margin: 4
    }}>
      <MaterialIcons name={iconName} size={24} color={isReceived ? colors.textSecondary : 'rgba(255,255,255,0.7)'} />
      <Text style={{ 
        color: isReceived ? colors.textSecondary : 'rgba(255,255,255,0.7)',
        marginLeft: 8,
        fontSize: 14
      }}>
        {label}
      </Text>
    </View>
  );
}
