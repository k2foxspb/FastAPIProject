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
    KeyboardAvoidingView,
    Platform,
    Image
} from 'react-native';
import {
    getApp,
    getApps,
    getAuth,
    initializeApp,
    signInWithPhoneNumber,
    isSignInWithEmailLink,
    signInWithEmailLink,
    sendSignInLinkToEmail
} from '@react-native-firebase/auth';
import * as Linking from 'expo-linking';
import {usersApi, setAuthToken} from '../api';
import {API_BASE_URL} from '../constants';
import {useNotifications} from '../context/NotificationContext';
import {updateServerFcmToken} from '../utils/notifications';
import {storage} from '../utils/storage';
import {useTheme} from '../context/ThemeContext';
import {theme as themeConstants} from '../constants/theme';
import {Ionicons} from '@expo/vector-icons';
import ReCaptcha from '../components/ReCaptcha';

const {width} = Dimensions.get('window');

export default function LoginScreen({navigation}) {
    const {theme} = useTheme();
    const colors = themeConstants[theme];
    const [loading, setLoading] = useState(false);
    const [phoneNumber, setPhoneNumber] = useState('');
    const [email, setEmail] = useState('');
    const [loginMethod, setLoginMethod] = useState('phone'); // 'phone' or 'email'
    const [code, setCode] = useState('');
    const [confirm, setConfirm] = useState(null);
    const {connect, loadUser} = useNotifications();
    const recaptchaRef = useRef(null);
    const pendingAuthUser = useRef(null);

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

        // Обработка входящей ссылки для входа по email
        const handleInitialLink = async () => {
            const initialUrl = await Linking.getInitialURL();
            if (initialUrl) {
                handleSignInLink(initialUrl);
            }
        };

        handleInitialLink();

        const subscription = Linking.addEventListener('url', ({url}) => {
            handleSignInLink(url);
        });

        return () => subscription.remove();
    }, []);

    const handleAfterLogin = async (user, recaptchaToken = null) => {
        if (user) {
            if (!recaptchaToken && recaptchaRef.current) {
                pendingAuthUser.current = user;
                recaptchaRef.current.refreshToken();
                return;
            }

            setLoading(true);
            try {
                const idToken = await user.getIdToken();
                const fcmToken = await storage.getItem('fcm_token');
                const res = await usersApi.firebaseAuth(idToken, fcmToken, recaptchaToken);

                const {access_token, refresh_token, needs_phone, needs_email} = res.data;

                if (!access_token) {
                    throw new Error('Токен не получен от сервера');
                }

                await storage.saveTokens(access_token, refresh_token);
                setAuthToken(access_token);

                await loadUser();
                connect(access_token);

                if (needs_phone || needs_email) {
                    // Получаем свежего юзера для перехода в EditProfile
                    const userRes = await usersApi.getMe();
                    const userData = userRes.data;

                    Alert.alert(
                        'Завершение профиля',
                        'Пожалуйста, укажите ваш ' + (needs_phone ? 'номер телефона' : 'email') + ' для продолжения.',
                        [{
                            text: 'ОК',
                            onPress: () => navigation.replace('EditProfile', {user: userData})
                        }],
                        {cancelable: false}
                    );
                } else {
                    navigation.replace('ProfileMain');
                }
            } catch (error) {
                console.error('Firebase Auth Error:', error);
                Alert.alert('Ошибка', error.response?.data?.detail || error.message || 'Ошибка авторизации');
            } finally {
                setLoading(false);
            }
        }
    };

    const handleSignInWithPhoneNumber = async () => {
        if (!phoneNumber || phoneNumber.length < 10) {
            Alert.alert('Ошибка', 'Пожалуйста, введите корректный номер телефона');
            return;
        }

        try {
            setLoading(true);
            // Форматируем номер телефона (должен быть в формате +79991234567)
            let formattedPhone = phoneNumber;
            if (!formattedPhone.startsWith('+')) {
                if (formattedPhone.startsWith('8')) {
                    formattedPhone = '+7' + formattedPhone.substring(1);
                } else if (formattedPhone.startsWith('7')) {
                    formattedPhone = '+' + formattedPhone;
                } else {
                    formattedPhone = '+7' + formattedPhone;
                }
            }

            const confirmation = await signInWithPhoneNumber(getAuth(), formattedPhone);
            setConfirm(confirmation);
            console.log(confirmation);
        } catch (error) {
            console.error('Phone Auth Error:', error);
            Alert.alert('Ошибка', error.message || 'Не удалось отправить SMS');
            console.log('Phone auth full error:', JSON.stringify(error, null, 2));
            console.log('Phone auth code:', error?.code);
            console.log('Phone auth message:', error?.message);
        } finally {
            setLoading(false);
        }
    };

    const confirmCode = async () => {
        if (!code || code.length < 6) {
            Alert.alert('Ошибка', 'Введите 6-значный код из SMS');
            return;
        }

        try {
            setLoading(true);
            const result = await confirm.confirm(code);
            await handleAfterLogin(result.user);
        } catch (error) {
            console.error('Confirm Code Error:', error);
            Alert.alert('Ошибка', 'Неверный код подтверждения');
        } finally {
            setLoading(false);
        }
    };

    const handleSendSignInLinkToEmail = async () => {
        const trimmedEmail = email.trim();
        if (!trimmedEmail || !trimmedEmail.includes('@')) {
            Alert.alert('Ошибка', 'Пожалуйста, введите корректный адрес электронной почты');
            return;
        }

        try {
            setLoading(true);
            const actionCodeSettings = {
                url: 'https://fokin.fun/verify-email',
                handleCodeInApp: true,
                android: {
                    packageName: 'com.k2foxspb.fokinfun',
                    installApp: true,
                },
                ios: {
                    bundleId: 'com.k2foxspb.fokinfun',
                },
                iOS: {
                    bundleId: 'com.k2foxspb.fokinfun',
                },
            };

            const authInstance = getAuth();
            await sendSignInLinkToEmail(authInstance, trimmedEmail, actionCodeSettings);
            await storage.saveItem('email_for_sign_in', trimmedEmail);
            Alert.alert('Ссылка отправлена', 'Проверьте свою почту для завершения входа');
        } catch (error) {
            console.error('Email Link Send Error:', error);
            Alert.alert('Ошибка', error.message || 'Не удалось отправить ссылку на почту');
        } finally {
            setLoading(false);
        }
    };

    const handleSignInLink = async (link) => {
        if (!link) return;

        if (isSignInWithEmailLink(getAuth(), link)) {
            try {
                setLoading(true);
                let storedEmail = await storage.getItem('email_for_sign_in');

                if (!storedEmail) {
                    // Если email не сохранен, просим пользователя ввести его в поле ввода
                    setLoginMethod('email');
                    Alert.alert(
                        'Подтвердите email',
                        'Пожалуйста, введите ваш адрес электронной почты в поле ввода для завершения входа.'
                    );
                    return;
                }

                const result = await signInWithEmailLink(getAuth(), storedEmail, link);
                await handleAfterLogin(result.user);
                await storage.removeItem('email_for_sign_in');
            } catch (error) {
                console.error('Email Link Auth Error:', error);
                Alert.alert('Ошибка', error.message || 'Не удалось войти по ссылке');
            } finally {
                setLoading(false);
            }
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

    const handleRecaptchaVerify = (token) => {
        if (pendingAuthUser.current) {
            handleAfterLogin(pendingAuthUser.current, token);
            pendingAuthUser.current = null;
        }
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={[styles.container, {backgroundColor: colors.background}]}
        >
            <ReCaptcha ref={recaptchaRef} onVerify={handleRecaptchaVerify}/>
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

                <Text style={[styles.title, {color: colors.text}]}>FokinShop</Text>
                <Text style={[styles.subtitle, {color: colors.textSecondary}]}>
                    {loginMethod === 'phone' ? 'Вход по номеру телефона' : 'Вход по адресу почты'}
                </Text>

                {loginMethod === 'phone' ? (
                    !confirm ? (
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
                                    disabled={loading}
                                />
                            </View>

                            <TouchableOpacity
                                style={[
                                    styles.primaryButton,
                                    {backgroundColor: colors.primary},
                                    loading && styles.buttonDisabled
                                ]}
                                onPress={handleSignInWithPhoneNumber}
                                disabled={loading}
                                activeOpacity={0.8}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#fff"/>
                                ) : (
                                    <Text style={styles.primaryButtonText}>Получить код</Text>
                                )}
                            </TouchableOpacity>

                            <TouchableOpacity
                                onPress={() => setLoginMethod('email')}
                                style={{marginTop: 16, alignItems: 'center'}}
                            >
                                <Text style={{color: colors.primary}}>Использовать почту</Text>
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
                                    disabled={loading}
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
                                onPress={() => setConfirm(null)}
                                style={{marginTop: 16, alignItems: 'center'}}
                            >
                                <Text style={{color: colors.primary}}>Изменить номер</Text>
                            </TouchableOpacity>
                        </>
                    )
                ) : (
                    <>
                        <View style={[styles.inputContainer, {
                            backgroundColor: colors.surface,
                            borderColor: colors.border
                        }]}>
                            <Ionicons name="mail-outline" size={20} color={colors.textSecondary}
                                      style={{marginRight: 12}}/>
                            <TextInput
                                style={[styles.input, {color: colors.text}]}
                                placeholder="Ваша почта (email@domain.com)"
                                placeholderTextColor={colors.textSecondary + '80'}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                value={email}
                                onChangeText={setEmail}
                                disabled={loading}
                            />
                        </View>

                        <TouchableOpacity
                            style={[
                                styles.primaryButton,
                                {backgroundColor: colors.primary},
                                loading && styles.buttonDisabled
                            ]}
                            onPress={handleSendSignInLinkToEmail}
                            disabled={loading}
                            activeOpacity={0.8}
                        >
                            {loading ? (
                                <ActivityIndicator color="#fff"/>
                            ) : (
                                <Text style={styles.primaryButtonText}>Отправить ссылку</Text>
                            )}
                        </TouchableOpacity>

                        <TouchableOpacity
                            onPress={() => setLoginMethod('phone')}
                            style={{marginTop: 16, alignItems: 'center'}}
                        >
                            <Text style={{color: colors.primary}}>Использовать телефон</Text>
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
    googleButton: {
        height: 60,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        ...getShadow('#000', {width: 0, height: 4}, 0.05, 10, 2)
    },
    buttonContent: {flexDirection: 'row', alignItems: 'center'},
    buttonDisabled: {opacity: 0.7},
    buttonText: {fontWeight: '600', fontSize: 17},
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
