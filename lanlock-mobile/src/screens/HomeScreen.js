import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchDevices, getApiErrorMessage } from '../api/auth';

const YELLOW = '#FACC15';
const BG = '#0F1923';
const CARD_BG = '#1F2731';

const truncatePcId = (pcId) => {
    if (pcId.length <= 16) return pcId;
    return `${pcId.slice(0, 8)}…${pcId.slice(-6)}`;
};

const DeviceCard = ({ item }) => (
    <View style={styles.card}>
        <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
                <Ionicons name="desktop-outline" size={20} color={YELLOW} />
            </View>
            <Text style={styles.pcId} numberOfLines={1}>
                {truncatePcId(item.pcId)}
            </Text>
        </View>
        <View style={styles.cardFooter}>
            <View style={styles.statusRow}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>Offline</Text>
            </View>
            <Text style={styles.linkedAt}>
                Linked {new Date(item.linkedAt).toLocaleDateString()}
            </Text>
        </View>
    </View>
);

export default function HomeScreen({ navigation }) {
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(null);

    const loadDevices = useCallback(async () => {
        setError(null);
        try {
            const data = await fetchDevices();
            setDevices(data);
        } catch (err) {
            setError(getApiErrorMessage(err, 'Failed to load devices'));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        loadDevices();
    }, [loadDevices]);

    const onRefresh = () => {
        setRefreshing(true);
        loadDevices();
    };

    if (loading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={YELLOW} />
            </View>
        );
    }

    if (error) {
        return (
            <View style={styles.centerContainer}>
                <Ionicons name="cloud-offline-outline" size={48} color="#4B5563" />
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={loadDevices} activeOpacity={0.8}>
                    <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <FlatList
                data={devices}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => <DeviceCard item={item} />}
                contentContainerStyle={[
                    styles.listContent,
                    devices.length === 0 && styles.emptyList,
                ]}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor={YELLOW}
                        colors={[YELLOW]}
                    />
                }
                ListHeaderComponent={
                    <Text style={styles.sectionHeader}>
                        MY DEVICES ({devices.length})
                    </Text>
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Ionicons name="desktop-outline" size={56} color="#2D3748" />
                        <Text style={styles.emptyTitle}>No PCs linked yet</Text>
                        <Text style={styles.emptySubtitle}>
                            Scan the QR code on your desktop app to pair a device.
                        </Text>
                    </View>
                }
            />
            <TouchableOpacity
                style={styles.fab}
                onPress={() => navigation.navigate('Scan')}
                activeOpacity={0.8}
            >
                <Ionicons name="qr-code-outline" size={32} color={BG} />
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: BG,
    },
    centerContainer: {
        flex: 1,
        backgroundColor: BG,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    listContent: {
        padding: 16,
        paddingBottom: 100,
    },
    emptyList: {
        flexGrow: 1,
    },
    sectionHeader: {
        fontSize: 11,
        fontWeight: '700',
        color: '#4B5563',
        letterSpacing: 1.2,
        marginBottom: 12,
    },
    card: {
        backgroundColor: CARD_BG,
        borderRadius: 10,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: 'rgba(250, 204, 21, 0.15)',
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    cardIcon: {
        width: 36,
        height: 36,
        borderRadius: 8,
        backgroundColor: 'rgba(250, 204, 21, 0.1)',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
    },
    pcId: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
        color: '#E2E8F0',
    },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#4B5563',
        marginRight: 6,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#6B7280',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    linkedAt: {
        fontSize: 11,
        color: '#4B5563',
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 80,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#4B5563',
        marginTop: 16,
        marginBottom: 8,
    },
    emptySubtitle: {
        fontSize: 14,
        color: '#374151',
        textAlign: 'center',
        lineHeight: 20,
    },
    errorText: {
        color: '#9CA3AF',
        fontSize: 15,
        textAlign: 'center',
        marginTop: 12,
        marginBottom: 20,
    },
    retryButton: {
        backgroundColor: YELLOW,
        paddingHorizontal: 24,
        paddingVertical: 10,
        borderRadius: 8,
    },
    retryText: {
        color: BG,
        fontWeight: '700',
        fontSize: 14,
    },
    fab: {
        position: 'absolute',
        bottom: 24,
        right: 24,
        backgroundColor: YELLOW,
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 8,
        shadowColor: YELLOW,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 6,
    },
});
