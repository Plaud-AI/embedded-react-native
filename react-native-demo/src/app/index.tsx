import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DevButton, DevCard, Mono, Overline, Pill, WaveBars } from '@/components/plaud/dev-ui';
import { FileModal } from '@/components/plaud/file-modal';
import { Icon } from '@/components/plaud/icon';
import type { FileResult, PlaudFile, PlaudScanDevice } from '@/components/plaud/types';
import { BottomTabInset, MaxContentWidth, PlaudColors, Spacing } from '@/constants/theme';

const PLAUD_DOMAIN = 'platform-us.plaud.ai';
const USER_ID = 'jackmu';

// --- Mock data (stands in for the native Plaud SDK, not yet wired up) ---
const MOCK_DEVICES: PlaudScanDevice[] = [
  { name: 'Plaud Note Pro', serialNumber: 'PN-4823', uuid: 'uuid-note-pro' },
  { name: 'Plaud NotePin', serialNumber: 'NP-1150', uuid: 'uuid-notepin' },
];

const MOCK_FILES: PlaudFile[] = [
  { sessionId: 1042, duration: 342, size: 5_242_880 },
  { sessionId: 1041, duration: 128, size: 1_998_848 },
  { sessionId: 1039, duration: 74, size: 1_146_880 },
];

const MOCK_TRANSCRIPT =
  "Okay, so for the Q3 roadmap, the two big rocks are the native SDK bridge and the " +
  'transcription pipeline. Let’s get the export flow stable first, then layer streaming ' +
  'on top. I’ll circle back with the team on timelines by Friday.';

export default function Home() {
  const [devices, setDevices] = useState<PlaudScanDevice[]>([]);
  const [files, setFiles] = useState<PlaudFile[]>([]);
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [tokenReady, setTokenReady] = useState(false);

  const [results, setResults] = useState<Record<number, FileResult>>({});
  const [openSessionId, setOpenSessionId] = useState<number | null>(null);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  // Simulate minting the per-user access token on mount.
  useEffect(() => {
    const t = setTimeout(() => setTokenReady(true), 500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const updateResult = (sessionId: number, patch: Partial<FileResult>) =>
    setResults((prev) => ({ ...prev, [sessionId]: { ...prev[sessionId], ...patch } }));

  const handleScan = () => {
    setError(null);
    if (!tokenReady) {
      setError('User token not ready yet — try again in a moment.');
      return;
    }
    setDevices([]);
    setScanning(true);
    // Devices trickle in from the BLE scan.
    later(() => setDevices([MOCK_DEVICES[0]]), 700);
    later(() => setDevices(MOCK_DEVICES), 1400);
  };

  const handleConnect = (_d: PlaudScanDevice) => {
    setError(null);
    setScanning(false);
    setConnected(true);
    setFiles(MOCK_FILES);

    // Recording is driven by the physical device — simulate a capture arriving
    // shortly after connect so the live banner is visible.
    later(() => {
      setIsLive(true);
      setRecording('Recording · session 1043 · scene meeting');
    }, 900);
    later(() => {
      setIsLive(false);
      setRecording('Stopped · session 1043 · 812 KB');
      setFiles((prev) => [{ sessionId: 1043, duration: 52, size: 831_488 }, ...prev]);
    }, 4400);
  };

  const handleDepair = () => {
    Alert.alert('Unpair device', 'Unpair this device and clear local pairing state?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unpair',
        style: 'destructive',
        onPress: () => {
          setConnected(false);
          setDevices([]);
          setFiles([]);
          setRecording(null);
          setIsLive(false);
          setResults({});
          setOpenSessionId(null);
        },
      },
    ]);
  };

  const exportAndTranscribe = (f: PlaudFile) => {
    setError(null);
    updateResult(f.sessionId, {
      status: 'exporting',
      exportInfo: 'starting…',
      error: undefined,
      transcript: null,
      transcribeStatus: undefined,
      src: undefined,
    });
    later(() => updateResult(f.sessionId, { exportInfo: '48% decoding…' }), 500);
    later(
      () =>
        updateResult(f.sessionId, {
          status: 'transcribing',
          src: 'mock://exported.mp3',
          exportInfo: 'saved → exported.mp3',
          transcribeStatus: 'uploading to Plaud… 100%',
        }),
      1200,
    );
    later(
      () => updateResult(f.sessionId, { transcribeStatus: 'transcribing… (processing)' }),
      1900,
    );
    later(
      () =>
        updateResult(f.sessionId, {
          status: 'ready',
          transcribeStatus: 'transcription complete',
          transcript: MOCK_TRANSCRIPT,
        }),
      3000,
    );
  };

  const handleFileClick = (f: PlaudFile) => {
    setOpenSessionId(f.sessionId);
    if (results[f.sessionId]?.status === 'ready') return;
    exportAndTranscribe(f);
  };

  const handleRefreshFiles = () => {
    setError(null);
    setFiles(files.length ? files : MOCK_FILES);
  };

  const openFile = openSessionId != null ? files.find((x) => x.sessionId === openSessionId) : null;

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.main} showsVerticalScrollIndicator={false}>
          {/* Intro */}
          <View>
            <Text style={styles.h1}>Connect. Record. Transcribe.</Text>
            <Text style={styles.lede}>
              Pair a Plaud recorder over Bluetooth, capture on-device, then export and
              transcribe — straight from the native bridge.
            </Text>
          </View>

          {/* Primary actions */}
          <View style={styles.actions}>
            {!connected && (
              <DevButton
                label={scanning ? 'Scanning…' : 'Init & scan'}
                icon="radar"
                variant="primary"
                disabled={scanning}
                onPress={handleScan}
                style={styles.grow}
              />
            )}
            {connected && (
              <DevButton
                label="Unpair"
                icon="unlink"
                variant="destructive"
                onPress={handleDepair}
                style={styles.grow}
              />
            )}
          </View>

          {/* Live recording banner */}
          {recording && (
            <DevCard style={[styles.banner, isLive && styles.bannerLive]}>
              {isLive ? (
                <WaveBars />
              ) : (
                <Icon name="fileAudio" size={20} color={PlaudColors.textLight} />
              )}
              <View style={styles.bannerText}>
                <Overline style={styles.bannerOverline}>{isLive ? 'Live' : 'Last capture'}</Overline>
                <Mono numberOfLines={1} style={styles.bannerDetail}>
                  {recording}
                </Mono>
              </View>
            </DevCard>
          )}

          {/* Error banner */}
          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Discovered devices — tap to connect. */}
          {devices.length > 0 && !connected && scanning && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Overline>Devices</Overline>
                <Mono style={styles.caption}>{devices.length} found</Mono>
              </View>
              <View style={styles.list}>
                {devices.map((d) => (
                  <Pressable
                    key={d.serialNumber || d.uuid}
                    onPress={() => handleConnect(d)}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                    <Text numberOfLines={1} style={styles.rowTitle}>
                      {d.name || d.serialNumber || d.uuid}
                    </Text>
                    <Mono style={styles.rowAction}>Connect</Mono>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* Recordings on the connected device — tap to export/transcribe. */}
          {connected && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Overline>Recordings</Overline>
                <Pressable onPress={handleRefreshFiles} style={styles.refresh} hitSlop={8}>
                  <Icon name="refresh" size={14} color={PlaudColors.accentBlue} />
                  <Text style={styles.refreshText}>Refresh</Text>
                </Pressable>
              </View>
              {files.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>
                    No recordings yet. Record on the device, then refresh.
                  </Text>
                </View>
              ) : (
                <View style={styles.list}>
                  {files.map((f) => {
                    const r = results[f.sessionId];
                    return (
                      <Pressable
                        key={f.sessionId}
                        onPress={() => handleFileClick(f)}
                        style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                        <View style={styles.rowLeft}>
                          <Icon name="fileAudio" size={18} color={PlaudColors.textLight} />
                          <Mono style={styles.rowId}>#{f.sessionId}</Mono>
                          {r?.status === 'ready' && (
                            <View style={styles.rowTag}>
                              <Icon name="fileText" size={12} color={PlaudColors.statusOk} />
                              <Text style={styles.tagOk}>transcribed</Text>
                            </View>
                          )}
                          {(r?.status === 'exporting' || r?.status === 'transcribing') && (
                            <Text style={styles.tagBusy}>processing…</Text>
                          )}
                        </View>
                        <Mono style={styles.rowMeta}>
                          {f.duration}s · {(f.size / 1024).toFixed(0)} KB
                        </Mono>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Footer band */}
      <View style={styles.footer}>
        <Mono style={styles.footerText}>
          {USER_ID}@{PLAUD_DOMAIN}
        </Mono>
        <Pill>
          <View
            style={[
              styles.tokenDot,
              { backgroundColor: tokenReady ? PlaudColors.statusOk : PlaudColors.textFaint },
            ]}
          />
          <Mono style={styles.tokenText}>token {tokenReady ? 'ready' : 'loading…'}</Mono>
        </Pill>
      </View>

      {openFile && (
        <FileModal
          file={openFile}
          result={results[openFile.sessionId]}
          onClose={() => setOpenSessionId(null)}
          onRetry={() => exportAndTranscribe(openFile)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: PlaudColors.surface,
  },
  safeArea: {
    flex: 1,
  },
  main: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
  },
  h1: {
    fontSize: 32,
    lineHeight: 34,
    color: PlaudColors.textWhite,
    letterSpacing: -0.3,
  },
  lede: {
    marginTop: 12,
    fontSize: 15,
    lineHeight: 21,
    color: PlaudColors.textDim,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  grow: {
    flex: 1,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  bannerLive: {
    borderColor: 'rgba(241,80,66,0.45)',
  },
  bannerText: {
    flex: 1,
    minWidth: 0,
  },
  bannerOverline: {
    marginBottom: 2,
  },
  bannerDetail: {
    fontSize: 13,
    color: PlaudColors.textLight,
  },
  errorCard: {
    backgroundColor: PlaudColors.surfaceCard,
    borderWidth: 1,
    borderColor: 'rgba(241,80,66,0.4)',
    borderRadius: 5,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  errorText: {
    fontSize: 13,
    color: PlaudColors.statusError,
  },
  section: {
    gap: 12,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  caption: {
    fontSize: 12,
    color: PlaudColors.textFaint,
  },
  list: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: PlaudColors.surfaceInput,
    borderWidth: 1,
    borderColor: PlaudColors.borderSubtle,
    borderRadius: 5,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  pressed: {
    opacity: 0.7,
  },
  rowTitle: {
    flex: 1,
    fontSize: 15,
    color: PlaudColors.textLight,
  },
  rowAction: {
    fontSize: 12,
    color: PlaudColors.textLight,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 1,
  },
  rowId: {
    fontSize: 14,
    color: PlaudColors.textLight,
  },
  rowTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tagOk: {
    fontSize: 11,
    color: PlaudColors.statusOk,
  },
  tagBusy: {
    fontSize: 11,
    color: PlaudColors.accentBlue,
  },
  rowMeta: {
    fontSize: 12,
    color: PlaudColors.textFaint,
  },
  refresh: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  refreshText: {
    fontSize: 12,
    color: PlaudColors.accentBlue,
  },
  emptyCard: {
    backgroundColor: PlaudColors.surfaceCard,
    borderWidth: 1,
    borderColor: PlaudColors.borderSubtle,
    borderRadius: 5,
    paddingHorizontal: 16,
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: PlaudColors.textDim,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    paddingBottom: BottomTabInset,
    backgroundColor: PlaudColors.surfaceFooter,
    borderTopWidth: 1,
    borderTopColor: PlaudColors.borderSubtle,
  },
  footerText: {
    fontSize: 12,
    color: PlaudColors.textFaint,
  },
  tokenDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
  tokenText: {
    fontSize: 12,
    color: PlaudColors.textMuted,
  },
});
