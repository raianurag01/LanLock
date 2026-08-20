import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
    fetchDevices,
    fetchDeviceSummary,
    getApiErrorMessage,
    lockPc,
    pushMessageToPc,
} from '../api/auth';
import { fetchWalletSummary, topupWallet } from '../api/wallet';
import { useAuth } from '../context/AuthContext';
import { userSocket } from '../api/socket';
import Toast from '../components/Toast';

const YELLOW = '#FACC15';
const BG = '#121212';
const CARD_BG = '#1C1C1E';
const ONLINE_GREEN = '#22C55E';

const truncatePcId = (pcId) => {
    if (pcId.length <= 16) return pcId;
    return `${pcId.slice(0, 8)}…${pcId.slice(-6)}`;
};

// Mock security feed — pure demo dressing, no backend behind it.
const MOCK_ACTIVITY = [
    {
        id: 'act-1',
        icon: 'lock-closed',
        color: YELLOW,
        title: 'PC Locked',
        time: '10:24 AM',
        detail: '45m session',
    },
    {
        id: 'act-2',
        icon: 'shield-checkmark',
        color: ONLINE_GREEN,
        title: 'LanLock Agent Active',
        time: '09:30 AM',
        detail: 'Auto-Guard enabled',
    },
    {
        id: 'act-3',
        icon: 'alert-circle',
        color: '#EF4444',
        title: 'Unauthorized Access Attempt Blocked',
        time: '08:15 AM',
        detail: 'Input rejected while locked',
    },
    {
        id: 'act-4',
        icon: 'phone-portrait',
        color: '#60A5FA',
        title: 'Mobile Pairing Confirmed',
        time: '08:02 AM',
        detail: 'QR handshake verified',
    },
];

const pad2 = (n) => String(n).padStart(2, '0');

const formatDuration = (totalSeconds) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
};

// Big live counter at the top of the screen. Idle (gray, 00:00:00) until a PC
// is paired; ticks from zero while the session is live.
const SessionTimerCard = ({ seconds, active }) => (
    <View style={styles.timerCard}>
        <View style={styles.timerLabelRow}>
            <View style={[styles.timerLiveDot, !active && styles.timerIdleDot]} />
            <Text style={styles.timerLabel}>
                {active ? 'CURRENT SESSION' : 'NO ACTIVE SESSION'}
            </Text>
        </View>
        <Text style={[styles.timerValue, !active && styles.timerValueIdle]}>
            {formatDuration(seconds)}
        </Text>
        <Text style={styles.timerSubtitle}>
            {active
                ? 'Session active · billed to Digital Wallet'
                : 'Pair a PC to start a session'}
        </Text>
    </View>
);

// Three-up KPI row. Duration ticks off the same session clock as the hero
// timer; status and last-lock come live from GET /devices/summary.
const StatTile = ({ label, children }) => (
    <View style={styles.statTile}>
        <Text style={styles.statLabel}>{label}</Text>
        {children}
    </View>
);

const SECURITY_META = {
    PROTECTED: { label: 'Protected', color: ONLINE_GREEN, icon: 'shield-checkmark' },
    AT_RISK: { label: 'Agent Offline', color: '#EF4444', icon: 'shield-half' },
    STANDBY: { label: 'Standby', color: '#6B7280', icon: 'shield-outline' },
};

const formatLastLocked = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === new Date().toDateString()) return time;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
};

const AnalyticsCard = ({ seconds, securityStatus, lastLockedAt }) => {
    const meta = SECURITY_META[securityStatus] ?? SECURITY_META.STANDBY;
    return (
        <View style={styles.analyticsCard}>
            <StatTile label="Session Duration">
                <Text style={styles.statValueMono}>{formatDuration(seconds)}</Text>
            </StatTile>
            <View style={styles.statDivider} />
            <StatTile label="Security Status">
                <View style={styles.statInlineRow}>
                    <Ionicons name={meta.icon} size={14} color={meta.color} />
                    <Text style={[styles.statValue, { color: meta.color }]}>
                        {meta.label}
                    </Text>
                </View>
            </StatTile>
            <View style={styles.statDivider} />
            <StatTile label="Last Locked">
                <Text style={styles.statValue}>{formatLastLocked(lastLockedAt)}</Text>
            </StatTile>
        </View>
    );
};

const ActivityRow = ({ item, isLast }) => (
    <View style={[styles.activityRow, !isLast && styles.activityRowBorder]}>
        <View style={[styles.activityIcon, { backgroundColor: `${item.color}1A` }]}>
            <Ionicons name={item.icon} size={16} color={item.color} />
        </View>
        <View style={styles.activityText}>
            <Text style={styles.activityTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.activityDetail}>{item.detail}</Text>
        </View>
        <Text style={styles.activityTime}>{item.time}</Text>
    </View>
);

const ActivityTimeline = () => (
    <View style={styles.timelineCard}>
        {MOCK_ACTIVITY.map((item, index) => (
            <ActivityRow
                key={item.id}
                item={item}
                isLast={index === MOCK_ACTIVITY.length - 1}
            />
        ))}
    </View>
);

const PushMessageCard = ({ value, onChange, onPush }) => (
    <View style={styles.messageCard}>
        <Text style={styles.messageHint}>
            Display a custom note on the PC lock screen.
        </Text>
        <View style={styles.messageInputRow}>
            <TextInput
                style={styles.messageInput}
                value={value}
                onChangeText={onChange}
                placeholder="e.g. Back in 5 minutes…"
                placeholderTextColor="#4B5563"
                maxLength={80}
                returnKeyType="send"
                onSubmitEditing={onPush}
            />
            <TouchableOpacity
                style={[styles.pushButton, !value.trim() && styles.pushButtonDisabled]}
                onPress={onPush}
                activeOpacity={0.85}
                disabled={!value.trim()}
            >
                <Ionicons name="paper-plane" size={16} color={BG} />
                <Text style={styles.pushButtonText}>Push Message</Text>
            </TouchableOpacity>
        </View>
    </View>
);

// Premium header: placeholder avatar + the signed-in user's identity.
const ProfileHeader = ({ username, onLogout }) => (
    <View style={styles.profileHeader}>
        <View style={styles.avatar}>
            <Ionicons name="person" size={22} color={BG} />
        </View>
        <View style={styles.profileText}>
            <Text style={styles.greeting}>Welcome back</Text>
            <Text style={styles.username}>{username || 'Gamer'}</Text>
        </View>
        <TouchableOpacity style={styles.bellButton} activeOpacity={0.7} onPress={onLogout}>
            <Ionicons name="log-out-outline" size={22} color="#9CA3AF" />
        </TouchableOpacity>
    </View>
);

// Real metered billing: balance + LanCoins come from GET /wallet/summary;
// the server is authoritative (it charges on lock). The live ₹ ticker below
// is a client-side estimate at the same ₹100/hr rate the server bills at
// (WalletService.RATE_PER_HOUR), so it never drifts from the eventual charge
// by more than rounding.
const DISPLAY_RATE_PER_HOUR = 100; // ₹/hr — must match wallet.constants.ts
const COINS_GOAL = 1000; // 1000 LanCoins = 1 free hour

const WalletCard = ({ balance, sessionSeconds, active, lanCoins, coinsEnabled, onTopUp }) => {
    const sessionCost = (sessionSeconds / 3600) * DISPLAY_RATE_PER_HOUR;
    const negative = balance < 0;
    const coinsProgress = Math.min(lanCoins / COINS_GOAL, 1);
    // LanCoins is LURK's loyalty program only — hide the chip entirely at a
    // café that doesn't run it, unless the user already has a balance from a
    // past LURK session.
    const showCoins = coinsEnabled || lanCoins > 0;
    return (
        <View style={styles.walletCard}>
            <View style={styles.walletTopRow}>
                <View style={styles.walletLabelRow}>
                    <Ionicons name="wallet-outline" size={16} color={BG} />
                    <Text style={styles.walletLabel}>Digital Wallet</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="rgba(18,18,18,0.6)" />
            </View>
            <Text style={[styles.walletBalance, negative && styles.walletBalanceNegative]}>
                ₹{balance.toFixed(2)}
            </Text>
            {active && (
                <View style={styles.tickerChip}>
                    <View style={styles.tickerDot} />
                    <Text style={styles.tickerText}>
                        SESSION COST −₹{sessionCost.toFixed(2)} · ₹{DISPLAY_RATE_PER_HOUR}/hr
                    </Text>
                </View>
            )}
            {showCoins && (
                <View style={styles.coinsChip}>
                    <View style={styles.coinsTopRow}>
                        <View style={styles.coinsLabelRow}>
                            <Ionicons name="medal" size={14} color={YELLOW} />
                            <Text style={styles.coinsCount}>{lanCoins} LanCoins</Text>
                        </View>
                        <Text style={styles.coinsGoal}>
                            {lanCoins >= COINS_GOAL ? 'FREE HOUR EARNED!' : '1000 = 1 FREE HOUR'}
                        </Text>
                    </View>
                    <View style={styles.coinsTrack}>
                        <View style={[styles.coinsFill, { width: `${coinsProgress * 100}%` }]} />
                    </View>
                </View>
            )}
            <View style={styles.walletBottomRow}>
                <Text style={styles.walletSubtitle}>
                    {negative ? 'Balance overdrawn' : 'Available balance'}
                </Text>
                <TouchableOpacity style={styles.topUpButton} activeOpacity={0.8} onPress={onTopUp}>
                    <Ionicons name="add" size={16} color={YELLOW} />
                    <Text style={styles.topUpText}>Top Up</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

// Preset top-up amounts. Alert.prompt (free-text input) is iOS-only in RN,
// so a fixed set of chips keeps the flow cross-platform.
const TOPUP_PRESETS = [100, 200, 500];

const TopUpModal = ({ visible, busy, onSelect, onClose }) => {
    if (!visible) return null;
    return (
        <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Top Up Wallet</Text>
                <Text style={styles.modalHint}>Mock payment — no real charge.</Text>
                <View style={styles.modalChipsRow}>
                    {TOPUP_PRESETS.map((amount) => (
                        <TouchableOpacity
                            key={amount}
                            style={[styles.modalChip, busy && styles.modalChipDisabled]}
                            activeOpacity={0.8}
                            disabled={busy}
                            onPress={() => onSelect(amount)}
                        >
                            <Text style={styles.modalChipText}>₹{amount}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
                <TouchableOpacity style={styles.modalCancel} onPress={onClose} disabled={busy}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

const DeviceCard = ({ item, onLock, isLocking, online, gameName }) => (
    <View style={styles.card}>
        <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
                <Ionicons name="desktop-outline" size={20} color={YELLOW} />
            </View>
            <Text style={styles.pcId} numberOfLines={1}>
                {truncatePcId(item.pcId)}
            </Text>
        </View>
        {gameName != null && (
            <View style={styles.gameRow}>
                <Ionicons name="game-controller" size={14} color={YELLOW} />
                <Text style={styles.gameRowText}>{gameName} running</Text>
            </View>
        )}
        <View style={styles.cardFooter}>
            {/* Real agent connectivity from /devices/summary. Defaults to
                online while the first summary is still loading so a freshly
                linked PC never flashes "Offline". */}
            <View style={styles.statusRow}>
                <View style={[styles.statusDot, !online && styles.statusDotOffline]} />
                <Text style={[styles.statusText, !online && styles.statusTextOffline]}>
                    {online ? 'Online' : 'Offline'}
                </Text>
            </View>
            <Text style={styles.linkedAt}>
                Linked {new Date(item.linkedAt).toLocaleDateString()}
            </Text>
        </View>
        <TouchableOpacity
            style={[styles.lockButton, isLocking && styles.lockButtonDisabled]}
            onPress={() => onLock(item)}
            activeOpacity={0.85}
            disabled={isLocking}
        >
            {isLocking ? (
                <ActivityIndicator size="small" color={BG} />
            ) : (
                <Ionicons name="lock-closed" size={18} color={BG} />
            )}
            <Text style={styles.lockButtonText}>
                {isLocking ? 'Locking…' : 'End Session & Lock PC'}
            </Text>
        </TouchableOpacity>
    </View>
);

export default function HomeScreen({ navigation }) {
    // Signed-in profile + sign-out from the app-wide auth context.
    const { user: profile, signOut } = useAuth();
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(null);
    // pcId of the device whose lock request is currently in flight (or null).
    const [lockingPcId, setLockingPcId] = useState(null);
    // Session clock. Only runs while a PC is actually paired — counts up from
    // zero on pairing, drops back to idle when the session ends.
    const [sessionSeconds, setSessionSeconds] = useState(0);
    const [lockMessage, setLockMessage] = useState('');
    const [toastText, setToastText] = useState(null);
    // Latest /devices/summary payload (null until first successful fetch).
    const [summary, setSummary] = useState(null);
    // Latest /wallet/summary payload — balance, LanCoins, and the server's
    // record of the active device session (source of truth for the timer).
    const [wallet, setWallet] = useState(null);
    const [toppingUp, setToppingUp] = useState(false);
    const [topUpVisible, setTopUpVisible] = useState(false);
    // Off-screen above the notch; showToast springs it down to 0.
    const toastY = useRef(new Animated.Value(-160)).current;
    const toastTimer = useRef(null);

    const hasActiveSession = devices.length > 0;
    const activeSessionStart = wallet?.activeSession?.startTime ?? null;

    // Timer derives from the server's session startTime instead of counting
    // locally — it survives an app restart mid-session (the old local
    // counter reset to 0 on every mount).
    useEffect(() => {
        if (!activeSessionStart) {
            setSessionSeconds(0);
            return undefined;
        }
        const startMs = new Date(activeSessionStart).getTime();
        const tick = () => setSessionSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [activeSessionStart]);

    // Mount-scoped: the toast timer must survive pairing changes.
    useEffect(() => {
        return () => {
            if (toastTimer.current) clearTimeout(toastTimer.current);
        };
    }, []);

    const showToast = (text) => {
        setToastText(text);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        Animated.spring(toastY, {
            toValue: 0,
            friction: 8,
            tension: 60,
            useNativeDriver: true,
        }).start();
        toastTimer.current = setTimeout(() => {
            Animated.timing(toastY, { toValue: -160, duration: 250, useNativeDriver: true })
                .start(() => setToastText(null));
        }, 3000);
    };

    // Real push: backend relays over the desktop agent's socket, and the PC
    // shows the text as an on-screen banner.
    const handlePushMessage = async () => {
        const text = lockMessage.trim();
        if (!text) return;
        const pcId = devices[0]?.pcId;
        if (!pcId) {
            showToast('Pair a PC first');
            return;
        }
        try {
            const result = await pushMessageToPc(pcId, text);
            setLockMessage('');
            showToast(result.delivered ? 'Message sent to PC' : 'Sent — PC currently offline');
        } catch (err) {
            Alert.alert('Message failed', getApiErrorMessage(err, 'Could not reach the PC.'));
        }
    };

    // Live posture from GET /devices/summary. Non-critical: on failure keep
    // the last known summary so the analytics degrade gracefully.
    const loadSummary = useCallback(async () => {
        try {
            const data = await fetchDeviceSummary();
            setSummary(data);
        } catch (err) {
            console.log('summary fetch failed:', getApiErrorMessage(err));
        }
    }, []);

    // Balance + LanCoins + the server's active-session startTime. Same
    // non-critical treatment as loadSummary.
    const loadWallet = useCallback(async () => {
        try {
            const data = await fetchWalletSummary();
            setWallet(data);
        } catch (err) {
            console.log('wallet fetch failed:', getApiErrorMessage(err));
        }
    }, []);

    const loadDevices = useCallback(async () => {
        setError(null);
        loadSummary();
        loadWallet();
        try {
            const data = await fetchDevices();
            setDevices(data);
        } catch (err) {
            setError(getApiErrorMessage(err, 'Failed to load devices'));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [loadSummary, loadWallet]);

    // Quiet background refresh of the device list, summary, and wallet.
    // Unlike loadDevices it never flashes the full-screen spinner/error —
    // used for focus + polling so a pairing shows up (and the timer starts)
    // without a manual pull-to-refresh.
    const syncSession = useCallback(async () => {
        loadSummary();
        loadWallet();
        try {
            const data = await fetchDevices();
            setDevices(data);
        } catch (err) {
            console.log('session sync failed:', getApiErrorMessage(err));
        }
    }, [loadSummary, loadWallet]);

    useEffect(() => {
        loadDevices();
    }, [loadDevices]);

    const handleLogout = () => {
        Alert.alert('Sign out?', 'You will need to sign in again to manage your PCs.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
        ]);
    };

    // Re-sync every time Home regains focus — this is what makes the timer
    // start on its own right after the QR scan (returning from the Scan
    // screen focuses Home), instead of waiting for a manual refresh.
    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', syncSession);
        return unsubscribe;
    }, [navigation, syncSession]);

    // Live updates from the user socket channel drive most of the
    // resyncing now — refetch-on-event instead of patching local state.
    // Poll is a slow fallback (self-heals a missed/dropped socket event).
    useEffect(() => {
        userSocket.on('device-connected', syncSession);
        userSocket.on('device-disconnected', syncSession);
        userSocket.on('device-locked', syncSession);
        userSocket.on('agent-status', syncSession);
        return () => {
            userSocket.off('device-connected', syncSession);
            userSocket.off('device-disconnected', syncSession);
            userSocket.off('device-locked', syncSession);
            userSocket.off('agent-status', syncSession);
        };
    }, [syncSession]);

    useEffect(() => {
        const id = setInterval(syncSession, 30_000);
        return () => clearInterval(id);
    }, [syncSession]);

    const onRefresh = () => {
        setRefreshing(true);
        loadDevices();
    };

    // Confirm, then hit the real lock endpoint. "Session Ended" only shows
    // once the backend has emitted lock-device to the desktop agent.
    const runLock = async (item) => {
        setLockingPcId(item.pcId);
        try {
            const result = await lockPc(item.pcId);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {
                // Haptics are unsupported on some devices/web — never let this
                // block the (already-successful) lock flow.
            });
            if (result.amountCharged != null) {
                const mins = Math.floor((result.sessionSeconds ?? 0) / 60);
                Alert.alert(
                    'Session ended',
                    `${mins} min · ₹${result.amountCharged} charged · Balance ₹${result.newBalance}`,
                );
            } else {
                showToast('PC Secured');
            }
            // The backend releases the pairing on lock — refresh so the
            // unlinked PC disappears from the list and the wallet reflects
            // the charge.
            loadDevices();
        } catch (err) {
            Alert.alert('Lock failed', getApiErrorMessage(err, 'Could not lock this PC.'));
        } finally {
            setLockingPcId(null);
        }
    };

    const handleTopUp = async (amount) => {
        setToppingUp(true);
        try {
            await topupWallet(amount);
            setTopUpVisible(false);
            showToast(`₹${amount} added`);
            loadWallet();
        } catch (err) {
            Alert.alert('Top up failed', getApiErrorMessage(err, 'Could not add funds.'));
        } finally {
            setToppingUp(false);
        }
    };

    const handleLock = (item) => {
        if (lockingPcId) return;
        const deviceState = summary?.devices?.find((d) => d.pcId === item.pcId);
        const graceNote = deviceState?.gameActive
            ? `\n\n🎮 ${deviceState.gameName ?? 'A game'} is running — a 60-second grace period will apply before the lock.`
            : '';
        Alert.alert(
            'End Session?',
            `This will lock ${truncatePcId(item.pcId)} and end the current gaming session.${graceNote}`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Lock PC',
                    style: 'destructive',
                    onPress: () => runLock(item),
                },
            ],
        );
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
                renderItem={({ item }) => (
                    <DeviceCard
                        item={item}
                        onLock={handleLock}
                        isLocking={lockingPcId === item.pcId}
                        online={
                            summary?.devices?.find((d) => d.pcId === item.pcId)?.online ?? true
                        }
                        gameName={
                            summary?.devices?.find((d) => d.pcId === item.pcId)?.gameName ?? null
                        }
                    />
                )}
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
                keyboardShouldPersistTaps="handled"
                ListHeaderComponent={
                    <View>
                        <ProfileHeader username={profile?.username} onLogout={handleLogout} />
                        <SessionTimerCard seconds={sessionSeconds} active={hasActiveSession} />
                        <WalletCard
                            balance={wallet?.balance ?? 0}
                            sessionSeconds={sessionSeconds}
                            active={hasActiveSession}
                            lanCoins={wallet?.lanCoins ?? 0}
                            coinsEnabled={wallet?.coinsEnabled ?? false}
                            onTopUp={() => setTopUpVisible(true)}
                        />
                        <Text style={styles.sectionHeader}>SESSION ANALYTICS</Text>
                        <AnalyticsCard
                            seconds={sessionSeconds}
                            securityStatus={summary?.securityStatus ?? 'STANDBY'}
                            lastLockedAt={summary?.lastLockedAt ?? null}
                        />
                        <Text style={[styles.sectionHeader, styles.sectionHeaderSpaced]}>
                            MY DEVICES ({devices.length})
                        </Text>
                    </View>
                }
                ListFooterComponent={
                    <View>
                        <Text style={[styles.sectionHeader, styles.sectionHeaderSpaced]}>
                            RECENT ACTIVITY
                        </Text>
                        <ActivityTimeline />
                        <Text style={[styles.sectionHeader, styles.sectionHeaderSpaced]}>
                            LOCK SCREEN MESSAGE
                        </Text>
                        <PushMessageCard
                            value={lockMessage}
                            onChange={setLockMessage}
                            onPush={handlePushMessage}
                        />
                    </View>
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
            {toastText && <Toast translateY={toastY} text={toastText} />}
            <TopUpModal
                visible={topUpVisible}
                busy={toppingUp}
                onSelect={handleTopUp}
                onClose={() => setTopUpVisible(false)}
            />
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
    profileHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
    },
    avatar: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: YELLOW,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    profileText: {
        flex: 1,
    },
    greeting: {
        fontSize: 12,
        color: '#9CA3AF',
        marginBottom: 2,
    },
    username: {
        fontSize: 18,
        fontWeight: '700',
        color: '#F9FAFB',
    },
    bellButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: CARD_BG,
        alignItems: 'center',
        justifyContent: 'center',
    },
    walletCard: {
        backgroundColor: YELLOW,
        borderRadius: 16,
        padding: 20,
        marginBottom: 24,
        shadowColor: YELLOW,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 6,
    },
    walletTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    walletLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    walletLabel: {
        fontSize: 13,
        fontWeight: '700',
        color: BG,
        letterSpacing: 0.3,
    },
    walletBalance: {
        fontSize: 36,
        fontWeight: '800',
        color: BG,
        marginTop: 12,
        marginBottom: 4,
    },
    walletBalanceNegative: {
        color: '#EF4444',
    },
    tickerChip: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 6,
        backgroundColor: 'rgba(18,18,18,0.12)',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
        marginBottom: 4,
    },
    tickerDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: BG,
    },
    tickerText: {
        fontSize: 11,
        fontWeight: '700',
        color: BG,
        fontVariant: ['tabular-nums'],
        letterSpacing: 0.2,
    },
    coinsChip: {
        backgroundColor: 'rgba(18,18,18,0.85)',
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginTop: 6,
        marginBottom: 4,
    },
    coinsTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    coinsLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    coinsCount: {
        fontSize: 13,
        fontWeight: '800',
        color: '#F9FAFB',
        fontVariant: ['tabular-nums'],
    },
    coinsGoal: {
        fontSize: 9,
        fontWeight: '800',
        color: YELLOW,
        letterSpacing: 0.5,
    },
    coinsTrack: {
        height: 5,
        borderRadius: 3,
        backgroundColor: 'rgba(255,255,255,0.15)',
        overflow: 'hidden',
    },
    coinsFill: {
        height: '100%',
        borderRadius: 3,
        backgroundColor: YELLOW,
    },
    walletBottomRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 8,
    },
    walletSubtitle: {
        fontSize: 13,
        color: 'rgba(18,18,18,0.7)',
        fontWeight: '500',
    },
    topUpButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: BG,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
    },
    topUpText: {
        color: YELLOW,
        fontWeight: '700',
        fontSize: 13,
    },
    sectionHeader: {
        fontSize: 11,
        fontWeight: '700',
        color: '#6B7280',
        letterSpacing: 1.2,
        marginBottom: 12,
    },
    sectionHeaderSpaced: {
        marginTop: 16,
    },
    timerCard: {
        backgroundColor: CARD_BG,
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(250, 204, 21, 0.2)',
    },
    timerLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 8,
    },
    timerLiveDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: ONLINE_GREEN,
        shadowColor: ONLINE_GREEN,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: 4,
        elevation: 4,
    },
    timerLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: '#9CA3AF',
        letterSpacing: 1.5,
    },
    timerValue: {
        fontSize: 44,
        fontWeight: '800',
        color: YELLOW,
        fontVariant: ['tabular-nums'],
        letterSpacing: 1,
    },
    timerValueIdle: {
        color: '#4B5563',
    },
    timerIdleDot: {
        backgroundColor: '#6B7280',
        shadowOpacity: 0,
        elevation: 0,
    },
    timerSubtitle: {
        fontSize: 12,
        color: '#6B7280',
        marginTop: 6,
    },
    analyticsCard: {
        flexDirection: 'row',
        alignItems: 'stretch',
        backgroundColor: CARD_BG,
        borderRadius: 12,
        paddingVertical: 16,
        paddingHorizontal: 8,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.06)',
    },
    statTile: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 4,
    },
    statDivider: {
        width: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        marginVertical: 2,
    },
    statLabel: {
        fontSize: 10,
        fontWeight: '700',
        color: '#6B7280',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginBottom: 6,
        textAlign: 'center',
    },
    statValue: {
        fontSize: 14,
        fontWeight: '700',
        color: '#F9FAFB',
    },
    statValueMono: {
        fontSize: 14,
        fontWeight: '700',
        color: '#F9FAFB',
        fontVariant: ['tabular-nums'],
    },
    statInlineRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    timelineCard: {
        backgroundColor: CARD_BG,
        borderRadius: 12,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.06)',
    },
    activityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
    },
    activityRowBorder: {
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    },
    activityIcon: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    activityText: {
        flex: 1,
        marginRight: 8,
    },
    activityTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: '#E2E8F0',
        marginBottom: 2,
    },
    activityDetail: {
        fontSize: 11,
        color: '#6B7280',
    },
    activityTime: {
        fontSize: 11,
        fontWeight: '600',
        color: '#9CA3AF',
    },
    messageCard: {
        backgroundColor: CARD_BG,
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.06)',
    },
    messageHint: {
        fontSize: 12,
        color: '#9CA3AF',
        marginBottom: 12,
    },
    messageInputRow: {
        gap: 10,
    },
    messageInput: {
        backgroundColor: BG,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 14,
        color: '#F9FAFB',
    },
    pushButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: YELLOW,
        paddingVertical: 12,
        borderRadius: 10,
    },
    pushButtonDisabled: {
        opacity: 0.4,
    },
    pushButtonText: {
        color: BG,
        fontSize: 14,
        fontWeight: '800',
        letterSpacing: 0.3,
    },
    card: {
        backgroundColor: CARD_BG,
        borderRadius: 12,
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
    gameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(250, 204, 21, 0.08)',
        borderWidth: 1,
        borderColor: 'rgba(250, 204, 21, 0.25)',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        marginBottom: 12,
        alignSelf: 'flex-start',
    },
    gameRowText: {
        fontSize: 12,
        fontWeight: '700',
        color: YELLOW,
    },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: ONLINE_GREEN,
        marginRight: 6,
        shadowColor: ONLINE_GREEN,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: 4,
        elevation: 4,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '700',
        color: ONLINE_GREEN,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    statusDotOffline: {
        backgroundColor: '#6B7280',
        shadowOpacity: 0,
        elevation: 0,
    },
    statusTextOffline: {
        color: '#6B7280',
    },
    linkedAt: {
        fontSize: 11,
        color: '#6B7280',
    },
    lockButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: YELLOW,
        paddingVertical: 14,
        borderRadius: 10,
    },
    lockButtonDisabled: {
        opacity: 0.6,
    },
    lockButtonText: {
        color: BG,
        fontSize: 15,
        fontWeight: '800',
        letterSpacing: 0.3,
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
        color: '#6B7280',
        marginTop: 16,
        marginBottom: 8,
    },
    emptySubtitle: {
        fontSize: 14,
        color: '#4B5563',
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
    modalOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 20,
    },
    modalCard: {
        width: '100%',
        backgroundColor: CARD_BG,
        borderRadius: 16,
        padding: 20,
        borderWidth: 1,
        borderColor: 'rgba(250, 204, 21, 0.2)',
    },
    modalTitle: {
        fontSize: 17,
        fontWeight: '800',
        color: '#F9FAFB',
        marginBottom: 4,
    },
    modalHint: {
        fontSize: 12,
        color: '#6B7280',
        marginBottom: 16,
    },
    modalChipsRow: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 16,
    },
    modalChip: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 14,
        borderRadius: 10,
        backgroundColor: YELLOW,
    },
    modalChipDisabled: {
        opacity: 0.5,
    },
    modalChipText: {
        color: BG,
        fontSize: 15,
        fontWeight: '800',
    },
    modalCancel: {
        alignItems: 'center',
        paddingVertical: 10,
    },
    modalCancelText: {
        color: '#9CA3AF',
        fontSize: 14,
        fontWeight: '600',
    },
});
