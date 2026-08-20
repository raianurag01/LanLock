import React from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const ONLINE_GREEN = '#22C55E';

// Top-mounted toast. Parent drives translateY so slide-in/out stays in step
// with its own show/hide timer (see HomeScreen's showToast for the pattern:
// spring in on show, timing out after a few seconds). Shared between Home
// and Orders so both screens get the same lightweight confirmation UI.
export default function Toast({ translateY, text }) {
    return (
        <Animated.View style={[styles.toast, { transform: [{ translateY }] }]}>
            <View style={styles.toastIcon}>
                <Ionicons name="shield-checkmark" size={16} color={ONLINE_GREEN} />
            </View>
            <Text style={styles.toastText}>{text}</Text>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    toast: {
        position: 'absolute',
        top: 60,
        left: 16,
        right: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#27272A',
        borderRadius: 14,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: 'rgba(34, 197, 94, 0.35)',
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.45,
        shadowRadius: 10,
        zIndex: 10,
    },
    toastIcon: {
        width: 28,
        height: 28,
        borderRadius: 8,
        backgroundColor: 'rgba(34, 197, 94, 0.12)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    toastText: {
        flex: 1,
        color: '#F9FAFB',
        fontSize: 14,
        fontWeight: '700',
        letterSpacing: 0.2,
    },
});
