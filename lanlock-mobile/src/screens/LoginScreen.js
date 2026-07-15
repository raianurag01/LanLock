import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
} from 'react-native';
import { login, getApiErrorMessage } from '../api/auth';
import { saveToken } from '../utils/secureStore';

export default function LoginScreen({ navigation }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleLogin = async () => {
        if (!email.trim() || !password) {
            Alert.alert('Missing details', 'Please enter your email and password.');
            return;
        }

        setSubmitting(true);
        try {
            const { accessToken } = await login({
                email: email.trim(),
                password,
            });
            await saveToken(accessToken);

            // Only reached on a 2xx response — reset the stack so the user
            // cannot navigate "back" into the auth flow.
            navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
        } catch (error) {
            Alert.alert('Login failed', getApiErrorMessage(error, 'Invalid credentials'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <KeyboardAvoidingView
            className="flex-1 bg-background"
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <ScrollView
                contentContainerClassName="flex-grow justify-center px-6 py-12"
                keyboardShouldPersistTaps="handled"
            >
                {/* Brand header */}
                <View className="mb-10">
                    <View className="h-1 w-10 bg-primary mb-4" />
                    <Text className="text-4xl font-extrabold uppercase tracking-widest text-white">
                        LanLock
                    </Text>
                    <Text className="mt-2 text-base text-gray-400">
                        Sign in to your account
                    </Text>
                </View>

                {/* Email */}
                <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Email
                </Text>
                <TextInput
                    className="mb-5 rounded-lg border border-white/10 bg-surface px-4 py-3.5 text-base text-white"
                    placeholder="you@example.com"
                    placeholderTextColor="#718096"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    value={email}
                    onChangeText={setEmail}
                    editable={!submitting}
                />

                {/* Password */}
                <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Password
                </Text>
                <TextInput
                    className="mb-8 rounded-lg border border-white/10 bg-surface px-4 py-3.5 text-base text-white"
                    placeholder="••••••••"
                    placeholderTextColor="#718096"
                    autoCapitalize="none"
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                    editable={!submitting}
                />

                {/* Submit */}
                <TouchableOpacity
                    className={`items-center rounded-lg py-4 ${submitting ? 'bg-primary/60' : 'bg-primary'}`}
                    activeOpacity={0.85}
                    onPress={handleLogin}
                    disabled={submitting}
                >
                    {submitting ? (
                        <ActivityIndicator color="#FFFFFF" />
                    ) : (
                        <Text className="text-base font-bold uppercase tracking-wider text-white">
                            Sign In
                        </Text>
                    )}
                </TouchableOpacity>

                {/* Link to signup */}
                <View className="mt-6 flex-row justify-center">
                    <Text className="text-gray-400">Don&apos;t have an account? </Text>
                    <TouchableOpacity
                        onPress={() => navigation.navigate('Signup')}
                        disabled={submitting}
                    >
                        <Text className="font-semibold text-action">Create one</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}
