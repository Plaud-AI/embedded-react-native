import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Fonts, PlaudColors, PlaudRadius } from '@/constants/theme';
import { DevButton, DevCard, Mono, Overline } from './dev-ui';
import { Icon } from './icon';
import type { FileResult, PlaudFile } from './types';

export function FileModal({
  file,
  result,
  onClose,
  onRetry,
}: {
  file: PlaudFile;
  result: FileResult | undefined;
  onClose: () => void;
  onRetry: () => void;
}) {
  const status = result?.status;
  const busy = status === 'exporting' || status === 'transcribing';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Stop taps inside the card from closing the modal. */}
        <Pressable style={styles.cardWrap} onPress={() => { }}>
          <DevCard style={styles.card}>
            {/* Header */}
            <View style={styles.header}>
              <View>
                <Overline>Recording</Overline>
                <Mono style={styles.sessionTitle}>Session #{file.sessionId}</Mono>
                <Mono style={styles.meta}>
                  {file.duration}s · {(file.size / 1024).toFixed(0)} KB
                </Mono>
              </View>
              <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={12}>
                <Icon name="close" size={22} color={PlaudColors.textDim} />
              </Pressable>
            </View>

            {/* Progress line while exporting / transcribing. */}
            {busy && result?.transcribeStatus && (
              <Mono style={styles.progress}>{result.transcribeStatus}</Mono>
            )}
            {status === 'exporting' && (
              <Mono style={styles.progress}>{result?.exportInfo ?? 'exporting…'}</Mono>
            )}

            {/* Error + retry. */}
            {status === 'error' && (
              <View style={styles.errorBlock}>
                <Text style={styles.errorText}>{result?.error ?? 'Something went wrong.'}</Text>
                <DevButton label="Retry" onPress={onRetry} style={styles.retry} />
              </View>
            )}

            {/* Transcript, once ready. */}
            {status === 'ready' && (
              <View style={styles.transcriptSection}>
                <View style={styles.transcriptLabel}>
                  <Icon name="fileText" size={14} color={PlaudColors.textFaint} />
                  <Overline>Transcript</Overline>
                </View>
                <ScrollView style={styles.transcriptBox} contentContainerStyle={styles.transcriptInner}>
                  <Text
                    style={[
                      styles.transcriptText,
                      { color: result?.transcript ? PlaudColors.textLight : PlaudColors.textDim },
                    ]}>
                    {result?.transcript || 'No speech detected.'}
                  </Text>
                </ScrollView>
              </View>
            )}
          </DevCard>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  cardWrap: {
    width: '100%',
    maxWidth: 448,
    alignSelf: 'center',
  },
  card: {
    height: '90%',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sessionTitle: {
    fontSize: 18,
    marginTop: 4,
    color: PlaudColors.textWhite,
  },
  meta: {
    fontSize: 12,
    marginTop: 4,
    color: PlaudColors.textFaint,
  },
  audio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: PlaudColors.surfaceInput,
    borderWidth: 1,
    borderColor: PlaudColors.borderSubtle,
    borderRadius: PlaudRadius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  audioTrack: {
    flex: 1,
    height: 3,
    borderRadius: 999,
    backgroundColor: PlaudColors.borderFocus,
  },
  audioTime: {
    fontSize: 12,
    color: PlaudColors.textDim,
  },
  placeholder: {
    backgroundColor: PlaudColors.surfaceInput,
    borderWidth: 1,
    borderColor: PlaudColors.borderSubtle,
    borderRadius: PlaudRadius.sm,
    paddingHorizontal: 16,
    paddingVertical: 24,
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 13,
    color: PlaudColors.textDim,
  },
  progress: {
    fontSize: 12,
    marginTop: 16,
    color: PlaudColors.accentBlue,
  },
  errorBlock: {
    marginTop: 16,
  },
  errorText: {
    fontSize: 13,
    color: PlaudColors.statusError,
  },
  retry: {
    marginTop: 12,
  },
  transcriptSection: {
    marginTop: 16,
    flex: 1,
  },
  transcriptLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  transcriptBox: {
    flex: 1,
    backgroundColor: PlaudColors.surfaceInput,
    borderWidth: 1,
    borderColor: PlaudColors.borderSubtle,
    borderRadius: PlaudRadius.sm,
  },
  transcriptInner: {
    padding: 12,
  },
  transcriptText: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: Fonts.sans,
  },
});
