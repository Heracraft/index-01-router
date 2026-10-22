# Architecture

One SvelteKit 3 app (adapter-node), one Postgres, one data volume. Optional sidecars in the same
compose file: `obsidian-rest` (Heracraft/obsidian-remote-rest-api, headless vault server with MCP)
and `whisper` (whisper.cpp server).

```
Index 01 app ──POST multipart, HMAC signed──▶ /api/index01/webhook
                                                   │ verify, dedupe, store audio, log event
                                                   ▼
                                        recordings row (received)
                                                   │ pipeline worker (in process, concurrency 2)
                                                   ▼
                              transcribe (openai | openai-audio | gemini | whisper-cpp)
                                                   │ transcript saved (routing)
                                                   ▼
                     deliveries: one per enabled integration whose triggers match
                                                   │ obsidian: MCP vault_patch under "## Notes"
                                                   ▼
                                            done | failed
```

## Index 01 webhook (protocol v1)

Source of truth: coredevices/mobileapp `INDEX_WEBHOOK_API.md`. Summary:

- `POST`, `multipart/form-data`, parts `audio` (audio/mp4 AAC 16 kHz mono, filename
  `<deliveryId>.m4a`), `transcription` (phone STT text), `test` (`true` on test events),
  `recordedAt` (epoch ms), `client` (`ring`). No `Origin` header.
- Headers: `X-Index-Webhook-Version: 1`, `X-Index-Trigger` (`single-click-hold`,
  `double-click-hold`, `test-event`), `X-Index-Test: true`, `X-Audio-Size`, and when signing is on
  `X-Index-Signature` (lowercase hex HMAC-SHA256), `X-Index-Timestamp` (unix seconds),
  `X-Index-Delivery`.
- Signed bytes: `"v1\n" + ts + "\n" + deliveryId + "\n" + trigger + "\n" + (test ? "1" : "0") + "\n"`
  followed by the raw body. Key is the secret as UTF-8. Tolerance 300 s.
- Any 2xx is success; nothing is retried at the HTTP level. Reply fast, do work in the background,
  answer duplicates with 200 (the app logs 409 as a failure). Error bodies show in the app's
  Recent runs (first 200 chars), so keep them short plain text.
- Delivery id without signing: the audio filename stem. A generic stem (`recording.m4a`, sent by
  apps that have no id) uses `audio-<recordedAt>-<sha256(audio) first 12>`. Transcription-only
  unsigned: `text-<recordedAt>-<sha256(transcript) first 12>`.
- A missing `X-Index-Trigger` means `single-click-hold` (apps before 1.10 had only that gesture).
- Test events: 200 `ok test`, logged in webhook_events, no recording. Duplicates: 200 `duplicate`.
- Other answers: 401 (signature), 400 (malformed, wrong version, size mismatch), 413 (over 50 MB),
  415 (not multipart), 500. Bodies are short plain text.

SvelteKit's form CSRF check runs before hooks and rejects multipart posts without Origin in
production, so `csrf.trustedOrigins` is `['*']` and `hooks.server.ts` does the Origin check for
every non-GET request outside the webhook. adapter-node needs `BODY_SIZE_LIMIT=50M`.

## Module contracts

All server code is under `src/lib/server`, imported as `#lib/server/<file>.ts` (no `$lib` in Kit 3).
Env comes from `$app/env/private` (declared in `src/env.ts`).

| File                          | Exports                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `db/schema.ts`, `db/index.ts` | tables, `db`, `runMigrations()`; casing is snake_case                                                                                                                                                                                                                                                                                |
| `crypto.ts`                   | `encrypt`, `decrypt`, `isEncrypted` (AES-GCM from AUTH_SECRET)                                                                                                                                                                                                                                                                       |
| `settings.ts`                 | `getSettings(key)`, `getStored(key)`, `setStored(key, value)`, `envLocks`; keys `transcription`, `general`, `webhook`                                                                                                                                                                                                                |
| `auth.ts`                     | OIDC `signIn`, `callback`, `signOut`, `handle`; `locals.session`                                                                                                                                                                                                                                                                     |
| `storage.ts`                  | `saveAudio(id, recordedAt, bytes, mime) -> {path, bytes}`, `absolutePath(rel)`, `deleteAudio(rel)`, `probeDurationMs(abs) -> number \| null`                                                                                                                                                                                         |
| `webhook-log.ts`              | `logWebhookEvent(event)` (never throws, keeps 200 rows), `listWebhookEvents(limit)`                                                                                                                                                                                                                                                  |
| `index01/verify.ts`           | `verifyIndexWebhook(headers, raw, secret, {toleranceSec?, nowSec?})`                                                                                                                                                                                                                                                                 |
| `ingest.ts`                   | `createRecording(input) -> {recording, duplicate}`; inserts row, stores audio, probes duration, calls `enqueue`; `deleteRecording(id) -> boolean`                                                                                                                                                                                    |
| `transcribe/index.ts`         | `transcribe(input, deps?) -> TranscribeResult`, `testTranscription(settings, deps?) -> string`, `PROVIDERS`                                                                                                                                                                                                                          |
| `transcribe/*.ts`             | one file per provider, `audio.ts` (ffmpeg decode/encode), `chunk.ts` (pause chunker)                                                                                                                                                                                                                                                 |
| `integrations/index.ts`       | `kinds`, `listIntegrations()` (secrets decrypted, server only), `listIntegrationsForUI()`/`getIntegrationForUI(id)` (secrets blanked, `secretsSet`), `getIntegration(id)`, `saveIntegration(input)`, `deleteIntegration(id)`, `testIntegration(kind, config, id?)`, `integrationMatches(integration, trigger)`, `TRIGGERS`, `isKind` |
| `integrations/obsidian.ts`    | the `obsidian` `IntegrationKind`, MCP client                                                                                                                                                                                                                                                                                         |
| `pipeline.ts`                 | `startWorker()`, `enqueue(id)`, `retryRecording(id, from)`, `redeliver(deliveryId)` (both return once queued, throw while the recording is busy), `onChange(listener)`, `whenIdle()`, `isProcessing(id)`                                                                                                                             |
| `time.ts`                     | `formatDate(date, format, timeZone)` with tokens YYYY MM DD HH mm ss ddd dddd MMM MMMM                                                                                                                                                                                                                                               |

`createRecording` input:

```ts
{
  deliveryId: string; source: 'ring' | 'upload'; trigger: string; signed: boolean;
  recordedAt: Date; audio?: { bytes: Uint8Array; mime: string }; appTranscript?: string | null;
}
```

A recording with no audio but an `appTranscript` skips transcription: the app transcript becomes
the transcript (`transcribedBy: 'index-app'`). The app transcript is also the fallback when
transcription fails or hears no speech; the recording's error then starts with "Used the app
transcript". No speech and no app transcript ends `done` with nothing delivered.

## Transcription

Settings live in the `transcription` settings row (`TranscriptionSettings` in `settings.ts`).

| Provider       | Call                                                                                                                  | Notes                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openai`       | `POST {baseUrl}/audio/transcriptions`                                                                                 | OpenAI `gpt-transcribe` (default) takes repeated `languages[]`, `prompt`; whisper-style models take one `language`. Works for Groq and speaches too |
| `openai-audio` | `POST {baseUrl}/chat/completions` with `input_audio`                                                                  | Audio piped into an LLM (`gpt-audio`). Strict verbatim prompt, JSON out `{text, languages}`                                                         |
| `gemini`       | `POST generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`                                        | `inline_data` audio, `responseSchema` JSON `{text, languages}`                                                                                      |
| `whisper-cpp`  | `POST {url}/inference` multipart `file` (16 kHz wav), `language=auto` or the one hint, `response_format=verbose_json` | Local, compose profile `whisper`                                                                                                                    |

Code-switched audio: no single `language` (it forces one), languages passed as hints where the
API supports a list, and the pause chunker (cuts at the longest pause between 15 and 30 s, 16 kHz
mono; each provider gets its own encoding: opus for openai, wav for openai-audio and
whisper-cpp, ogg/opus for gemini) since providers drop sentences at language switches in long clips (toolbar
measured 34% to 15% WER on Swahili/English).

## Integrations

`integrations` rows hold `kind`, `name`, `enabled`, `triggers` (empty = all; values
`single-click-hold`, `double-click-hold`, `upload`) and `config` (secrets encrypted).

### Obsidian

Talks MCP (Streamable HTTP, `Authorization: Bearer <key>`) to either the headless
`obsidian-remote-rest-api` container or the Local REST API plugin inside desktop Obsidian (same
`/mcp/` endpoint and tools). Neither knows about daily notes, so the path is computed here.

Config: `url` (`http://obsidian-rest:27123/mcp/`), `apiKey`, `insecureTls` (plugin's self-signed
27124 cert), `notePath` (`{{date:YYYY-MM-DD}}.md`), `heading` (`Notes`), `entryTemplate`
(`- {{time:HH:mm}} {{transcript}}`), `newNoteTemplate`.

Deliver: compute path in the general timezone from `recordedAt`, `vault_get_document_map`; if the
note is missing `vault_write` the new-note template; find the full heading path of `heading`
(paths are full: `["2026-10-22", "Notes"]`); `vault_patch` append with `createTargetIfMissing` and
`rejectIfContentPreexists` (a retry that finds its own entry counts as success). The section is read
first: an entry already there counts as delivered, and a section ending in a list is extended
in place so entries stay one tight list. Deliveries to one note are serialised in process.
`insecureTls` uses a `node:https` fetch, since undici is not a dependency. An identical entry
(same text, same minute) from a second recording is treated as already delivered.

## UI

Herakraft UI kit (`src/lib/styles/hk-tokens.css`, from Heracraft/branding). Rail: Recordings,
Integrations, Transcription, Webhook. Recording detail shows audio, transcript, languages,
provider, deliveries, with retry. Live updates over SSE (`/events`). Upload a file on Recordings
to run the same pipeline without the ring.
