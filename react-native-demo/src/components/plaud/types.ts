/** Minimal shapes mirroring the Plaud SDK types used by the Next.js demo's UI.
 * The real SDK isn't wired up yet — these back the mocked demo flow. */

export type PlaudScanDevice = {
  name?: string;
  serialNumber?: string;
  uuid: string;
};

export type PlaudFile = {
  sessionId: number;
  /** duration in seconds */
  duration: number;
  /** size in bytes */
  size: number;
};

/** Per-session export + transcription state, cached in the screen so a file that
 * has already been transcribed can be re-opened without redoing the work. */
export type FileResult = {
  status: 'exporting' | 'transcribing' | 'ready' | 'error';
  /** Truthy once the audio export finishes (a real path in the SDK build). */
  src?: string;
  exportInfo?: string;
  transcribeStatus?: string;
  transcript?: string | null;
  error?: string;
};
