import { File } from 'expo-file-system';

/**
 * Client-side Plaud transcription flow. ⚠️ DEMO ONLY.
 *
 * In production the Capacitor app called this from a backend, because it needs the
 * partner API key. Here we call the Plaud platform API directly from the device using
 * Expo public env vars — which means `EXPO_PUBLIC_PLAUD_CLIENT_ID` / `EXPO_PUBLIC_PLAUD_API_KEY`
 * are inlined into the JS bundle and are extractable. Fine for a demo build, never ship it.
 *
 * Flow (mirrors plaud-embedded-playground's /api/upload + /api/transcribe and the SDK
 * reference PlaudAPIService.swift):
 *   1. upload   → generate-presigned-urls → PUT parts to S3 → complete-upload → DownloadUrl
 *      (Bearer USER token — the same token passed to initSDK)
 *   2. submit   → POST /open/partner/ai/transcriptions/ { file_url }   (X-Client-* headers)
 *   3. poll     → GET  /open/partner/ai/transcriptions/{id}            (X-Client-* headers)
 */

const BASE_URL = 'https://platform-us.plaud.ai/developer/api';

type StatusFn = (message: string) => void;

/** Transcription API auth: partner client id + api key (X-Client-* headers). */
function transcriptionHeaders(): Record<string, string> {
  const clientId = process.env.EXPO_PUBLIC_PLAUD_CLIENT_ID;
  const apiKey = process.env.EXPO_PUBLIC_PLAUD_API_KEY;
  if (!clientId || !apiKey) {
    throw new Error(
      'Missing transcription credentials — set EXPO_PUBLIC_PLAUD_CLIENT_ID and EXPO_PUBLIC_PLAUD_API_KEY.',
    );
  }
  return { 'X-Client-Id': clientId, 'X-Client-Api-Key': apiKey };
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`HTTP ${res.status}: ${detail?.slice?.(0, 300) ?? detail}`);
  }
  return body;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// --- Step 1: S3 multipart upload (Bearer user token) → DownloadUrl ---

type PresignedPayload = {
  FileId: string;
  UploadId: string;
  ChunkSize: number;
  Parts: { PartNumber: number; PresignedUrl: string }[];
};

async function uploadFile(fileUri: string, userAccessToken: string, onStatus?: StatusFn): Promise<string> {
  const file = new File(fileUri);
  const size = file.size;
  if (size == null) throw new Error(`Exported file not found at ${fileUri}`);

  onStatus?.('requesting upload URLs…');
  const presigned: PresignedPayload = await readJson(
    await fetch(`${BASE_URL}/open/partner/files/upload/generate-presigned-urls`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filesize: size, filetype: 'mp3' }),
    }),
  );

  const chunkSize = presigned.ChunkSize;
  const parts = presigned.Parts ?? [];
  const uploadedParts: { PartNumber: number; ETag: string }[] = [];

  // Read the file into memory once. We can't use file.slice(): on React Native it does
  // `new Blob([bytes])`, and RN's Blob polyfill throws "creating blobs from arraybuffer are
  // not supported". Instead we PUT a Uint8Array chunk — RN's networking layer base64-encodes
  // typed-array bodies natively (see convertRequestBody).
  const bytes = new Uint8Array(await file.arrayBuffer());

  for (const part of parts) {
    const start = (part.PartNumber - 1) * chunkSize;
    const end = Math.min(start + chunkSize, size);
    const chunk = bytes.slice(start, end);
    onStatus?.(`uploading part ${part.PartNumber}/${parts.length}…`);
    const put = await fetch(part.PresignedUrl, { method: 'PUT', body: chunk });
    if (!put.ok) throw new Error(`Part ${part.PartNumber} upload failed (HTTP ${put.status})`);
    const etag = (put.headers.get('ETag') ?? '').replace(/"/g, '');
    if (!etag) throw new Error(`Part ${part.PartNumber} upload returned no ETag`);
    uploadedParts.push({ PartNumber: part.PartNumber, ETag: etag });
  }

  onStatus?.('finalizing upload…');
  const complete = await readJson(
    await fetch(`${BASE_URL}/open/partner/files/upload/complete-upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_id: presigned.FileId,
        upload_id: presigned.UploadId,
        part_list: uploadedParts,
        filetype: 'mp3',
        ...(file.md5 ? { file_md5: file.md5 } : {}),
      }),
    }),
  );

  const downloadUrl: string | undefined = complete?.DownloadUrl;
  if (!downloadUrl) throw new Error('complete-upload returned no DownloadUrl');
  return downloadUrl;
}

// --- Step 2 + 3: submit transcription and poll (X-Client-* headers) ---

async function submitTranscription(fileUrl: string, onStatus?: StatusFn): Promise<string> {
  onStatus?.('submitting transcription…');
  const body = {
    file_url: fileUrl,
    params: {
      transcribe: { language: 'auto', model: 'plaud-fast-whisper' },
      vad: { decode_silence: false },
      diarization: { enabled: false, return_embedding: false },
    },
  };
  const res = await readJson(
    await fetch(`${BASE_URL}/open/partner/ai/transcriptions/`, {
      method: 'POST',
      headers: { ...transcriptionHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  const id = res?.transcription_id ?? res?.data?.task_id;
  if (!id) throw new Error(`Submit returned no transcription id: ${JSON.stringify(res).slice(0, 200)}`);
  return String(id);
}

/** Pull the transcript text out of the poll response, whatever shape it arrives in. */
function extractTranscript(data: any): string {
  if (!data) return '';
  if (typeof data.text === 'string' && data.text.trim()) return data.text;
  if (Array.isArray(data.results)) {
    return data.results.map((r: any) => r?.text ?? '').filter(Boolean).join('\n\n');
  }
  if (Array.isArray(data.segments)) {
    return data.segments.map((s: any) => s?.text ?? '').filter(Boolean).join(' ');
  }
  return '';
}

async function pollTranscription(
  transcriptionId: string,
  onStatus?: StatusFn,
  { intervalMs = 3000, timeoutMs = 180_000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await readJson(
      await fetch(`${BASE_URL}/open/partner/ai/transcriptions/${transcriptionId}`, {
        headers: transcriptionHeaders(),
      }),
    );
    const data = res?.data ?? res;
    const transcript = extractTranscript(data);
    if (transcript) return transcript;

    const status = String(res?.status ?? data?.task_status ?? '').toUpperCase();
    if (status.includes('FAIL') || status.includes('ERROR')) {
      throw new Error(`Transcription failed: ${status || 'unknown error'}`);
    }
    onStatus?.(`transcribing… (${status.toLowerCase() || 'processing'})`);
    await delay(intervalMs);
  }
  throw new Error('Transcription timed out');
}

/**
 * Upload an exported audio file and return its transcript. `fileUri` is the `file://` path
 * from `PlaudSdk.exportAudio`; `userAccessToken` is the token used for `initSDK`.
 */
export async function transcribeExportedFile(
  fileUri: string,
  userAccessToken: string,
  onStatus?: StatusFn,
): Promise<string> {
  const fileUrl = await uploadFile(fileUri, userAccessToken, onStatus);
  const transcriptionId = await submitTranscription(fileUrl, onStatus);
  return pollTranscription(transcriptionId, onStatus);
}
