# Tokens and transcription

Two things the native module does **not** do — both are your app/backend's responsibility.

## The per-user access token

`initSDK` requires a **per-user access token** (a Bearer JWT). The SDK does *not* mint it.

- **Production:** mint it via Plaud's partner OAuth flow on your backend and hand it to the
  client. The same token is used both for `initSDK` and for authenticating file uploads.
- **Local testing:** paste one via `EXPO_PUBLIC_PLAUD_ACCESS_TOKEN`. Expo inlines
  `EXPO_PUBLIC_*` at build time.

```ts
async function getUserAccessToken(): Promise<string> {
  const token = process.env.EXPO_PUBLIC_PLAUD_ACCESS_TOKEN;
  if (!token) throw new Error('No Plaud access token — wire a mint endpoint or set EXPO_PUBLIC_PLAUD_ACCESS_TOKEN.');
  return token;
}
```

> ⚠️ `EXPO_PUBLIC_*` vars are inlined into the JS bundle and are **extractable** from the app.
> Fine for a demo build; never ship credentials in the client.

## Transcription is plain HTTP, not the native module

Once a recording is exported to a local file (via `PlaudSdk.exportAudio`), uploading and
transcribing it is ordinary HTTP against the Plaud platform API — nothing to do with the native
bridge. In production this belongs **behind a backend** (it needs the partner API key). The
demo does it client-side for convenience only.

The full working implementation is `react-native-demo/src/lib/plaud-transcription.ts`. The flow:

1. **Upload** (Bearer *user* token — the same one passed to `initSDK`):
   `generate-presigned-urls` → PUT parts to S3 → `complete-upload` → returns a `DownloadUrl`.
2. **Submit** (`X-Client-Id` / `X-Client-Api-Key` partner headers):
   `POST /open/partner/ai/transcriptions/` with `{ file_url }`.
3. **Poll** (partner headers): `GET /open/partner/ai/transcriptions/{id}` until the transcript
   text is present or it fails/times out.

Base URL in the demo: `https://platform-us.plaud.ai/developer/api`.

### Two different credentials — don't mix them up

| Call | Auth |
| --- | --- |
| `initSDK` + file upload (presigned URLs, complete-upload) | `Authorization: Bearer <per-user token>` |
| Submit + poll transcription | `X-Client-Id` + `X-Client-Api-Key` (partner credentials) |

Partner credentials come from the Plaud Developer Portal:
`https://platform.plaud.ai/developer/portal`.

### RN-specific upload gotcha

Don't use `file.slice()` to chunk the upload — on React Native it does `new Blob([bytes])` and
RN's Blob polyfill throws "creating blobs from arraybuffer are not supported." Instead read the
file into a `Uint8Array` (`new Uint8Array(await file.arrayBuffer())`) and PUT typed-array
chunks; RN's networking layer base64-encodes typed-array bodies natively. This is already
handled in `plaud-transcription.ts` — copy that file rather than re-deriving it.

### Env vars (demo)

```
EXPO_PUBLIC_PLAUD_ACCESS_TOKEN=   # per-user Bearer JWT for initSDK + upload
EXPO_PUBLIC_PLAUD_CLIENT_ID=      # partner X-Client-Id (transcription)
EXPO_PUBLIC_PLAUD_API_KEY=        # partner X-Client-Api-Key (transcription)
```
