import React, {useState, useEffect, useRef} from 'react';
import {getShadow} from '../utils/shadowStyles';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
    Animated,
    Dimensions,
    TextInput,
    Image
} from 'react-native';
import {KeyboardAvoidingView} from 'react-native-keyboard-controller';
import {usersApi, setAuthToken} from '../api';
import {API_BASE_URL} from '../constants';
import {useNotifications} from '../context/NotificationContext';
import {storage} from '../utils/storage';
import {useTheme} from '../context/ThemeContext';
import {theme as themeConstants} from '../constants/theme';
import {Ionicons} from '@expo/vector-icons';

const {width} = Dimensions.get('window');

// Приводим введённый номер телефона к формату +7XXXXXXXXXX,
// в котором его ожидает бэкенд (нормализация дублируется на сервере).
function formatPhoneNumber(rawPhone) {
    let formattedPhone = rawPhone;
    if (!formattedPhone.startsWith('+')) {
        if (formattedPhone.startsWith('8')) {
            formattedPhone = '+7' + formattedPhone.substring(1);
        } else if (formattedPhone.startsWith('7')) {
            formattedPhone = '+' + formattedPhone;
        } else {
            formattedPhone = '+7' + formattedPhone;
        }
    }
    return formattedPhone;
}

export default function LoginScreen({navigation}) {
    const {theme} = useTheme();
    const colors = themeConstants[theme];
    const [loading, setLoading] = useState(false);
    const [phoneNumber, setPhoneNumber] = useState('');
    const [code, setCode] = useState('');
    const [confirm, setConfirm] = useState(null);
    const {connect, loadUser} = useNotifications();

    // Animations
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(30)).current;
    const logoScale = useRef(new Animated.Value(0.8)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 800,
                useNativeDriver: true,
            }),
            Animated.spring(slideAnim, {
                toValue: 0,
                tension: 50,
                friction: 7,
                useNativeDriver: true,
            }),
            Animated.spring(logoScale, {
                toValue: 1,
                tension: 50,
                friction: 7,
                useNativeDriver: true,
            })
        ]).start();
    }, []);

    const handleRequestCode = async () => {
        if (!phoneNumber || phoneNumber.length < 10) {
            Alert.alert('Ошибка', 'Пожалуйста, введите корректный номер телефона');
            return;
        }

        try {
            setLoading(true);
            const formattedPhone = formatPhoneNumber(phoneNumber);

            console.log('Requesting SMS code for:', formattedPhone);
            await usersApi.requestPhoneCode(formattedPhone);
            setConfirm({phone: formattedPhone});
            console.log('SMS code requested successfully');

            Alert.alert(
                'Код отправлен',
                'Мы отправили код подтверждения по SMS на указанный номер.'
            );
        } catch (error) {
            console.error('Phone Auth Error:', error);
            const detail = error.response?.data?.detail;
            const message = typeof detail === 'string' ? detail : (error.message || 'Не удалось отправить код');
            Alert.alert('Ошибка', message);
        } finally {
            setLoading(false);
        }
    };

    const confirmCode = async () => {
        if (!code || code.length < 4) {
            Alert.alert('Ошибка', 'Введите код подтверждения из SMS');
            return;
        }

        try {
            setLoading(true);
            const res = await usersApi.verifyPhoneCode(confirm.phone, code);
            console.log('Verification success, handling login...');

            const {access_token, refresh_token, needs_email} = res.data;

            await storage.saveTokens(access_token, refresh_token);
            setAuthToken(access_token);
            await loadUser();
            connect(access_token);

            if (needs_email) {
                const userRes = await usersApi.getMe();
                navigation.replace('EditProfile', {user: userRes.data, isInitialSetup: true});
            } else {
                navigation.reset({
                    index: 0,
                    routes: [{name: 'ProfileMain'}],
                });
            }
        } catch (error) {
            console.error('Confirm Code Error:', error);
            const detail = error.response?.data?.detail;
            const message = typeof detail === 'string' ? detail : (error.message || 'Неверный код подтверждения');
            Alert.alert('Ошибка', message);
        } finally {
            setLoading(false);
        }
    };

    const onPrivacyPolicy = () => {
        navigation.navigate('WebView', {
            url: `${API_BASE_URL}/privacy-policy`,
            title: 'Политика конфиденциальности'
        });
    };

    const onTermsOfUse = () => {
        navigation.navigate('WebView', {
            url: `${API_BASE_URL}/terms`,
            title: 'Правила использования'
        });
    };

    return (
        <KeyboardAvoidingView
            style={[styles.container, {backgroundColor: colors.background, flex: 1}]}
            behavior="padding"
            keyboardVerticalOffset={90}
        >
            <Animated.View
                style={[
                    styles.inner,
                    {
                        opacity: fadeAnim,
                        transform: [{translateY: slideAnim}]
                    }
                ]}
            >
                <Animated.View style={{transform: [{scale: logoScale}], alignSelf: 'center', marginBottom: 16}}>
                    <View style={styles.logoContainer}>
                        <Image
                            source={require('../../assets/logo120.png')}
                            style={{width: 100, height: 100}}
                            resizeMode="contain"
                        />
                    </View>
                </Animated.View>

                <Text style={[styles.title, {color: colors.text}]}>Fokin</Text>
                <Text style={[styles.subtitle, {color: colors.textSecondary}]}>
                    Вход по номеру телефона
                </Text>

                {!confirm ? (
                    <>
                        <View style={[styles.inputContainer, {
                            backgroundColor: colors.surface,
                            borderColor: colors.border
                        }]}>
                            <Ionicons name="call-outline" size={20} color={colors.textSecondary}
                                      style={{marginRight: 12}}/>
                            <TextInput
                                style={[styles.input, {color: colors.text}]}
                                placeholder="Номер телефона (+7...)"
                                placeholderTextColor={colors.textSecondary + '80'}
                                keyboardType="phone-pad"
                                value={phoneNumber}
                                onChangeText={setPhoneNumber}
                                editable={!loading}
                            />
                        </View>

                        <TouchableOpacity
                            style={[
                                styles.primaryButton,
                                {backgroundColor: colors.primary},
                                loading && styles.buttonDisabled
                            ]}
                            onPress={handleRequestCode}
                            disabled={loading}
                            activeOpacity={0.8}
                        >
                            {loading ? (
                                <ActivityIndicator color="#fff"/>
                            ) : (
                                <Text style={styles.primaryButtonText}>Получить код по SMS</Text>
                            )}
                        </TouchableOpacity>
                    </>
                ) : (
                    <>
                        <View style={[styles.inputContainer, {
                            backgroundColor: colors.surface,
                            borderColor: colors.border
                        }]}>
                            <Ionicons name="keypad-outline" size={20} color={colors.textSecondary}
                                      style={{marginRight: 12}}/>
                            <TextInput
                                style={[styles.input, {color: colors.text}]}
                                placeholder="Код из SMS"
                                placeholderTextColor={colors.textSecondary + '80'}
                                keyboardType="number-pad"
                                value={code}
                                onChangeText={setCode}
                                maxLength={6}
                                editable={!loading}
                            />
                        </View>

                        <TouchableOpacity
                            style={[
                                styles.primaryButton,
                                {backgroundColor: colors.primary},
                                loading && styles.buttonDisabled
                            ]}
                            onPress={confirmCode}
                            disabled={loading}
                            activeOpacity={0.8}
                        >
                            {loading ? (
                                <ActivityIndicator color="#fff"/>
                            ) : (
                                <Text style={styles.primaryButtonText}>Войти</Text>
                            )}
                        </TouchableOpacity>

                        <TouchableOpacity
                            onPress={() => {
                                setConfirm(null);
                                setCode('');
                            }}
                            style={{marginTop: 16, alignItems: 'center'}}
                        >
                            <Text style={{color: colors.primary}}>Изменить номер</Text>
                        </TouchableOpacity>
                    </>
                )}

                <View style={styles.features}>
                    <View style={styles.featureItem}>
                        <Ionicons name="flash-outline" size={20} color={colors.primary}/>
                        <Text style={[styles.featureText, {color: colors.textSecondary}]}>Быстрый вход</Text>
                    </View>
                    <View style={styles.featureItem}>
                        <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary}/>
                        <Text style={[styles.featureText, {color: colors.textSecondary}]}>Безопасно</Text>
                    </View>
                    <View style={styles.featureItem}>
                        <Ionicons name="sync-outline" size={20} color={colors.primary}/>
                        <Text style={[styles.featureText, {color: colors.textSecondary}]}>Синхронизация</Text>
                    </View>
                </View>

                <View style={styles.footer}>
                    <Text style={[styles.footerText, {color: colors.textSecondary}]}>
                        Используя приложение, вы соглашаетесь с{' '}
                        <Text
                            style={{textDecorationLine: 'underline', color: colors.primary}}
                            onPress={onTermsOfUse}
                        >
                            правилами использования
                        </Text>
                        {' '}и{' '}
                        <Text
                            style={{textDecorationLine: 'underline', color: colors.primary}}
                            onPress={onPrivacyPolicy}
                        >
                            политикой конфиденциальности
                        </Text>
                    </Text>
                </View>
            </Animated.View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {flex: 1},
    inner: {flex: 1, justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 16},
    logoContainer: {
        width: 100,
        height: 100,
        justifyContent: 'center',
        alignItems: 'center',
    },
    title: {fontSize: 32, fontWeight: '900', marginBottom: 8, textAlign: 'center', letterSpacing: -1.5},
    subtitle: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 32,
        lineHeight: 24,
        paddingHorizontal: 30,
        opacity: 0.8
    },
    buttonDisabled: {opacity: 0.7},
    features: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 32,
        paddingHorizontal: 10
    },
    featureItem: {alignItems: 'center'},
    featureText: {fontSize: 12, marginTop: 8, fontWeight: '500'},
    footer: {marginTop: 'auto', paddingHorizontal: 40, paddingTop: 20, paddingBottom: 20},
    footerText: {fontSize: 12, textAlign: 'center', opacity: 0.6},
    inputContainer: {
        height: 52,
        borderRadius: 16,
        borderWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        marginBottom: 12,
        ...getShadow('#000', {width: 0, height: 2}, 0.05, 5, 1),
    },
    input: {
        flex: 1,
        fontSize: 16,
        fontWeight: '500',
    },
    primaryButton: {
        height: 52,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        ...getShadow('#000', {width: 0, height: 4}, 0.1, 10, 2),
    },
    primaryButtonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '700',
    },
});
