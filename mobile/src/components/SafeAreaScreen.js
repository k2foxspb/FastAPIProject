import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Общий контейнер-обёртка для экранов, у которых отключён стандартный заголовок навигатора
// (headerShown: false) и которые рисуют собственный верхний/нижний интерфейс сами.
// React Navigation автоматически отодвигает контент от статус-бара/чёлки ТОЛЬКО когда
// показан его системный header — если header скрыт, контент экрана рисуется под самым
// верхним краем экрана и наезжает на системную область (статус-бар, вырез камеры и т.п.).
//
// ВАЖНО: любой НОВЫЙ экран с headerShown: false обязан учитывать безопасную зону — либо
// обернув свой корневой View в <SafeAreaScreen>, либо вручную применив
// useSafeAreaInsets().top/bottom к своим отступам (как это сделано, например, в ChatScreen).
export default function SafeAreaScreen({ children, style, edges = ['top'], ...props }) {
  const insets = useSafeAreaInsets();

  const edgeStyle = {};
  if (edges.includes('top')) edgeStyle.paddingTop = insets.top;
  if (edges.includes('bottom')) edgeStyle.paddingBottom = insets.bottom;
  if (edges.includes('left')) edgeStyle.paddingLeft = insets.left;
  if (edges.includes('right')) edgeStyle.paddingRight = insets.right;

  return (
    <View style={[{ flex: 1 }, edgeStyle, style]} {...props}>
      {children}
    </View>
  );
}
