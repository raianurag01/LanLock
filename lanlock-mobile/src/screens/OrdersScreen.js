import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchDevices, getApiErrorMessage } from '../api/auth';
import { fetchMyOrders, placeOrder } from '../api/orders';
import { FNB_MENU } from '../data/menu';
import { userSocket } from '../api/socket';
import Toast from '../components/Toast';

const YELLOW = '#FACC15';
const BG = '#121212';
const CARD_BG = '#1C1C1E';

const STATUS_META = {
    PLACED: { label: 'Placed', color: YELLOW },
    PREPARING: { label: 'Preparing', color: '#60A5FA' },
    DELIVERED: { label: 'Delivered', color: '#22C55E' },
    CANCELLED: { label: 'Cancelled', color: '#6B7280' },
};

const MenuRow = ({ entry, qty, onQtyChange, onOrder, disabled, ordering }) => (
    <View style={styles.menuRow}>
        <Text style={styles.menuEmoji}>{entry.emoji}</Text>
        <View style={styles.menuText}>
            <Text style={styles.menuName}>{entry.item}</Text>
            <Text style={styles.menuPrice}>₹{entry.price}</Text>
        </View>
        <View style={styles.stepper}>
            <TouchableOpacity
                style={styles.stepperButton}
                activeOpacity={0.7}
                disabled={disabled || qty <= 1}
                onPress={() => onQtyChange(Math.max(1, qty - 1))}
            >
                <Ionicons name="remove" size={16} color={disabled ? '#4B5563' : YELLOW} />
            </TouchableOpacity>
            <Text style={styles.stepperValue}>{qty}</Text>
            <TouchableOpacity
                style={styles.stepperButton}
                activeOpacity={0.7}
                disabled={disabled || qty >= 10}
                onPress={() => onQtyChange(Math.min(10, qty + 1))}
            >
                <Ionicons name="add" size={16} color={disabled ? '#4B5563' : YELLOW} />
            </TouchableOpacity>
        </View>
        <TouchableOpacity
            style={[styles.orderButton, disabled && styles.orderButtonDisabled]}
            activeOpacity={0.85}
            disabled={disabled}
            onPress={onOrder}
        >
            {ordering ? (
                <ActivityIndicator size="small" color={BG} />
            ) : (
                <Text style={styles.orderButtonText}>Order</Text>
            )}
        </TouchableOpacity>
    </View>
);

const OrderRow = ({ order }) => {
    const meta = STATUS_META[order.status] ?? STATUS_META.PLACED;
    const time = new Date(order.createdAt).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
    });
    return (
        <View style={styles.orderRow}>
            <View style={styles.orderRowText}>
                <Text style={styles.orderRowTitle}>
                    {order.qty}× {order.item}
                </Text>
                <Text style={styles.orderRowMeta}>
                    ₹{order.amount} · {time}
                </Text>
            </View>
            <View style={[styles.statusChip, { backgroundColor: `${meta.color}1A` }]}>
                <Text style={[styles.statusChipText, { color: meta.color }]}>{meta.label}</Text>
            </View>
        </View>
    );
};

export default function OrdersScreen() {
    const [devices, setDevices] = useState([]);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    // FNB_MENU item name -> chosen quantity (1-10, defaults to 1).
    const [quantities, setQuantities] = useState({});
    const [orderingItem, setOrderingItem] = useState(null);
    const [toastText, setToastText] = useState(null);
    const toastY = useRef(new Animated.Value(-160)).current;
    const toastTimer = useRef(null);

    const pcId = devices[0]?.pcId ?? null;

    const showToast = (text) => {
        setToastText(text);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        Animated.spring(toastY, { toValue: 0, friction: 8, tension: 60, useNativeDriver: true }).start();
        toastTimer.current = setTimeout(() => {
            Animated.timing(toastY, { toValue: -160, duration: 250, useNativeDriver: true }).start(() =>
                setToastText(null),
            );
        }, 3000);
    };

    useEffect(() => {
        return () => {
            if (toastTimer.current) clearTimeout(toastTimer.current);
        };
    }, []);

    const loadAll = useCallback(async () => {
        try {
            const [deviceList, orderList] = await Promise.all([fetchDevices(), fetchMyOrders()]);
            setDevices(deviceList);
            setOrders(orderList);
        } catch (err) {
            console.log('orders load failed:', getApiErrorMessage(err));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    // Live status pushes (admin marks PREPARING/DELIVERED) refresh the list
    // without polling; AuthContext fires the accompanying notification.
    useEffect(() => {
        userSocket.on('order-updated', loadAll);
        return () => userSocket.off('order-updated', loadAll);
    }, [loadAll]);

    const onRefresh = () => {
        setRefreshing(true);
        loadAll();
    };

    const handleOrder = async (entry) => {
        if (!pcId) return;
        const qty = quantities[entry.item] ?? 1;
        setOrderingItem(entry.item);
        try {
            await placeOrder({ pcId, item: entry.item, qty, amount: entry.price * qty });
            showToast(`${qty}× ${entry.item} ordered`);
            setQuantities((q) => ({ ...q, [entry.item]: 1 }));
            loadAll();
        } catch (err) {
            Alert.alert('Order failed', getApiErrorMessage(err, 'Could not place this order.'));
        } finally {
            setOrderingItem(null);
        }
    };

    if (loading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={YELLOW} />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <FlatList
                data={orders}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => <OrderRow order={item} />}
                contentContainerStyle={styles.listContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={YELLOW} colors={[YELLOW]} />
                }
                ListHeaderComponent={
                    <View>
                        {!pcId && (
                            <View style={styles.pairCard}>
                                <Ionicons name="desktop-outline" size={28} color="#4B5563" />
                                <Text style={styles.pairTitle}>Pair a PC to order</Text>
                                <Text style={styles.pairSubtitle}>
                                    Food & drinks are delivered to your seat — scan the QR on your
                                    desktop first.
                                </Text>
                            </View>
                        )}
                        <Text style={styles.sectionHeader}>MENU</Text>
                        <View style={styles.menuCard}>
                            {FNB_MENU.map((entry) => (
                                <MenuRow
                                    key={entry.item}
                                    entry={entry}
                                    qty={quantities[entry.item] ?? 1}
                                    onQtyChange={(qty) =>
                                        setQuantities((q) => ({ ...q, [entry.item]: qty }))
                                    }
                                    onOrder={() => handleOrder(entry)}
                                    disabled={!pcId || orderingItem !== null}
                                    ordering={orderingItem === entry.item}
                                />
                            ))}
                        </View>
                        <Text style={[styles.sectionHeader, styles.sectionHeaderSpaced]}>
                            MY ORDERS
                        </Text>
                    </View>
                }
                ListEmptyComponent={
                    <View style={styles.emptyOrders}>
                        <Text style={styles.emptyOrdersText}>No orders yet.</Text>
                    </View>
                }
            />
            {toastText && <Toast translateY={toastY} text={toastText} />}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    centerContainer: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
    listContent: { padding: 16, paddingBottom: 40 },
    sectionHeader: {
        fontSize: 11,
        fontWeight: '700',
        color: '#6B7280',
        letterSpacing: 1.2,
        marginBottom: 12,
    },
    sectionHeaderSpaced: { marginTop: 20 },
    pairCard: {
        backgroundColor: CARD_BG,
        borderRadius: 12,
        padding: 20,
        alignItems: 'center',
        marginBottom: 20,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.06)',
    },
    pairTitle: { fontSize: 15, fontWeight: '700', color: '#9CA3AF', marginTop: 10, marginBottom: 4 },
    pairSubtitle: { fontSize: 12, color: '#4B5563', textAlign: 'center', lineHeight: 18 },
    menuCard: {
        backgroundColor: CARD_BG,
        borderRadius: 12,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.06)',
    },
    menuRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.06)',
        gap: 10,
    },
    menuEmoji: { fontSize: 22 },
    menuText: { flex: 1 },
    menuName: { fontSize: 14, fontWeight: '600', color: '#E2E8F0' },
    menuPrice: { fontSize: 12, color: '#6B7280', marginTop: 2 },
    stepper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: BG,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
    },
    stepperButton: { paddingHorizontal: 8, paddingVertical: 6 },
    stepperValue: {
        color: '#F9FAFB',
        fontSize: 13,
        fontWeight: '700',
        minWidth: 16,
        textAlign: 'center',
    },
    orderButton: {
        backgroundColor: YELLOW,
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 8,
        minWidth: 64,
        alignItems: 'center',
    },
    orderButtonDisabled: { opacity: 0.4 },
    orderButtonText: { color: BG, fontSize: 13, fontWeight: '800' },
    orderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: CARD_BG,
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.06)',
    },
    orderRowText: { flex: 1, marginRight: 10 },
    orderRowTitle: { fontSize: 14, fontWeight: '600', color: '#E2E8F0' },
    orderRowMeta: { fontSize: 12, color: '#6B7280', marginTop: 2 },
    statusChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    statusChipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
    emptyOrders: { paddingVertical: 24, alignItems: 'center' },
    emptyOrdersText: { color: '#4B5563', fontSize: 13 },
});
