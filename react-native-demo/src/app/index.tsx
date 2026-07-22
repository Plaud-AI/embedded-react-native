import { File } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DevButton, DevCard, Mono, Overline, Pill, WaveBars } from '@/components/plaud/dev-ui';
import { FileModal } from '@/components/plaud/file-modal';
import { Icon } from '@/components/plaud/icon';
import type { FileResult, PlaudFile, PlaudScanDevice } from '@/components/plaud/types';
import { BottomTabInset, MaxContentWidth, PlaudColors, Spacing } from '@/constants/theme';
import { transcribeExportedFile } from '@/lib/plaud-transcription';
import { PlaudSdk, isAvailable } from 'plaud-sdk';

const PLAUD_DOMAIN = 'platform-us.plaud.ai';
const USER_ID = 'jackmu';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Mint the per-user Plaud JWT that `initSDK` requires. In the Capacitor demo the Next.js
 * web app minted this server-side; here it's an app/backend concern.
 *
 * TODO(plaud): wire this to your token endpoint. For local dev, set
 * `EXPO_PUBLIC_PLAUD_ACCESS_TOKEN` in a `.env` file (Expo inlines `EXPO_PUBLIC_*` at build).
 */
async function getUserAccessToken(): Promise<string> {
  const token = process.env.EXPO_PUBLIC_PLAUD_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'No Plaud access token — set EXPO_PUBLIC_PLAUD_ACCESS_TOKEN or wire a mint endpoint in getUserAccessToken().',
    );
  }
  return token;
}

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

  const updateResult = (sessionId: number, patch: Partial<FileResult>) =>
    setResults((prev) => ({ ...prev, [sessionId]: { ...prev[sessionId], ...patch } }));

  // Initialise the native SDK once, after minting the per-user token.
  useEffect(() => {
    if (!isAvailable) {
      setError('Plaud native module unavailable — run a dev build on a physical iOS device.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const userAccessToken = await getUserAccessToken();
        await PlaudSdk.initSDK({ userAccessToken, customDomain: PLAUD_DOMAIN, userId: USER_ID });
        if (!cancelled) setTokenReady(true);
      } catch (e) {
        if (!cancelled) setError(`SDK init failed: ${errMessage(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to the native event stream. Every listener drives a piece of screen state.
  useEffect(() => {
    if (!isAvailable) return;

    const subs = [
      PlaudSdk.addListener('scanResult', ({ devices: found }) => setDevices(found)),
      PlaudSdk.addListener('scanTimeout', ({ reason } = {}) => {
        setScanning(false);
        if (reason === 'bluetoothNotPoweredOn') {
          setError(
            'Bluetooth isn’t available — enable Bluetooth and grant the app permission, then try again.',
          );
        }
      }),
      PlaudSdk.addListener('connectState', ({ connected: isConn, failed }) => {
        if (isConn) {
          setConnected(true);
          setScanning(false);
          PlaudSdk.getFileList().catch((e) => setError(`getFileList failed: ${errMessage(e)}`));
        } else if (failed) {
          setScanning(false);
          setError('Connection failed — move the device closer and try again.');
        } else {
          setConnected(false);
        }
      }),
      PlaudSdk.addListener('fileList', ({ files: found }) => setFiles(found)),
      PlaudSdk.addListener('recordStart', ({ sessionId, scene }) => {
        setIsLive(true);
        setRecording(`Recording · session ${sessionId} · scene ${scene}`);
      }),
      PlaudSdk.addListener('recordResume', ({ sessionId }) => {
        setIsLive(true);
        setRecording(`Recording · session ${sessionId}`);
      }),
      PlaudSdk.addListener('recordStop', ({ sessionId, fileSize }) => {
        setIsLive(false);
        setRecording(`Stopped · session ${sessionId} · ${(fileSize / 1024).toFixed(0)} KB`);
        // A new recording just landed — refresh the on-device list.
        PlaudSdk.getFileList().catch(() => {});
      }),
      PlaudSdk.addListener('recordPause', ({ sessionId }) => {
        setIsLive(false);
        setRecording(`Paused · session ${sessionId}`);
      }),
      PlaudSdk.addListener('exportProgress', ({ sessionId, progress, message }) => {
        updateResult(sessionId, { exportInfo: `${progress}% ${message}` });
      }),
      PlaudSdk.addListener('depair', () => {
        setConnected(false);
        setDevices([]);
        setFiles([]);
        setRecording(null);
        setIsLive(false);
        setResults({});
        setOpenSessionId(null);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  const handleScan = () => {
    setError(null);
    if (!tokenReady) {
      setError('User token not ready yet — try again in a moment.');
      return;
    }
    setDevices([]);
    setScanning(true);
    PlaudSdk.startScan().catch((e) => {
      setScanning(false);
      setError(`Scan failed: ${errMessage(e)}`);
    });
  };

  const handleConnect = (d: PlaudScanDevice) => {
    setError(null);
    // Connection progress arrives via the `connectState` event (which flips `connected`
    // and loads the file list). Identify the device by uuid from the scan result.
    PlaudSdk.connectBleDevice({ uuid: d.uuid }).catch((e) =>
      setError(`Connect failed: ${errMessage(e)}`),
    );
  };

  const handleDepair = () => {
    Alert.alert('Unpair device', 'Unpair this device and clear local pairing state?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unpair',
        style: 'destructive',
        // State resets when the native `depair` event arrives.
        onPress: () =>
          PlaudSdk.depair({ clear: true }).catch((e) => setError(`Unpair failed: ${errMessage(e)}`)),
      },
    ]);
  };

  const exportAndTranscribe = async (f: PlaudFile) => {
    setError(null);
    updateResult(f.sessionId, {
      status: 'exporting',
      exportInfo: 'starting…',
      error: undefined,
      transcript: null,
      transcribeStatus: undefined,
      src: undefined,
    });
    try {
      // Native: decode the recording to an mp3 in Documents/PlaudExports. `exportProgress`
      // events update exportInfo along the way.
      const { outputPath } = await PlaudSdk.exportAudio({ sessionId: f.sessionId, format: 'mp3' });
      const uri = outputPath.startsWith('file://') ? outputPath : `file://${outputPath}`;
      const name = outputPath.split('/').pop() ?? 'export.mp3';
      let sizeLabel = '';
      try {
        const size = new File(uri).size;
        if (size != null) sizeLabel = ` (${(size / 1024).toFixed(0)} KB)`;
      } catch {
        // size is best-effort; the export itself already succeeded.
      }
      updateResult(f.sessionId, {
        status: 'transcribing',
        src: uri,
        exportInfo: `saved → ${name}${sizeLabel}`,
        transcribeStatus: 'preparing upload…',
      });

      // Upload the exported file to Plaud and poll for the transcript. ⚠️ DEMO ONLY — this
      // calls the Plaud platform API straight from the device with EXPO_PUBLIC_ credentials;
      // in production that upload/transcribe belongs behind a backend (see the Capacitor app).
      const userAccessToken = await getUserAccessToken();
      const transcript = await transcribeExportedFile(uri, userAccessToken, (msg) =>
        updateResult(f.sessionId, { transcribeStatus: msg }),
      );
      updateResult(f.sessionId, {
        status: 'ready',
        transcribeStatus: 'transcription complete',
        transcript,
      });
    } catch (e) {
      updateResult(f.sessionId, { status: 'error', error: errMessage(e) });
    }
  };

  const handleFileClick = (f: PlaudFile) => {
    setOpenSessionId(f.sessionId);
    if (results[f.sessionId]?.status === 'ready') return;
    exportAndTranscribe(f);
  };

  const handleRefreshFiles = () => {
    setError(null);
    PlaudSdk.getFileList().catch((e) => setError(`getFileList failed: ${errMessage(e)}`));
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
