# Architecture

One SvelteKit 3 app (adapter-node), one Postgres, one data volume: the two services in
`compose.yaml`. The Obsidian REST server (Heracraft/obsidian-remote-rest-api) and the optional
whisper.cpp server are hosted separately and reached by URL (`OBSIDIAN_MCP_URL`, the whisper.cpp
URL under Settings > Transcription).

```
Index 01 app ──POST multipart, HMAC signed──▶ /api/index01/webhook
                                                   │ verify, dedupe, store audio, log event
                                                   ▼
                                        recordings row (received)
                                                   │ pipeline worker (in process, concurrency 2)
                                                   ▼
                              transcribe (openai | openai-audio | whisper-cpp)
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
- Other answers: 401 (signature), 400 (malformed, wrong version, size mismatch), 413 (audio over
  50 MB or body over 51 MB), 415 (not multipart), 500. Bodies are short plain text. Header checks
  (version, signature headers, timestamp, content type, Content-Length) run before the body is
  read. A 500 logs its cause in webhook_events and answers only `internal error`.
- A row is inserted only after its audio file is written. A delivery id whose row expected audio
  and has none (a crash in an older version) is not a duplicate: the resend's audio completes it.
- webhook_events keeps the last 200 deliveries, signed requests and 500s, and separately the last
  50 unsigned 4xx rejections.

SvelteKit's form CSRF check runs before hooks and rejects multipart posts without Origin in
production, so `csrf.trustedOrigins` is `['*']` and `hooks.server.ts` does the Origin check for
every non-GET request outside the webhook. adapter-node needs `BODY_SIZE_LIMIT=51M`: 50 MB of audio plus 1 MB of multipart overhead.

## Module contracts

All server code is under `src/lib/server`, imported as `#lib/server/<file>.ts` (no `$lib` in Kit 3).
Env comes from `$app/env/private` (declared in `src/env.ts`).

| File                          | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db/schema.ts`, `db/index.ts` | tables, `db`, `runMigrations()`; casing is snake_case                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `crypto.ts`                   | `encrypt`, `decrypt`, `isEncrypted` (AES-GCM from AUTH_SECRET)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `settings.ts`                 | `getSettings(key)`, `getStored(key)`, `setStored(key, value)`, `envLocks`; keys `transcription`, `general`, `webhook`                                                                                                                                                                                                                                                                                                                                                            |
| `auth.ts`                     | OIDC `signIn`, `callback`, `signOut`, `handle`; `locals.session`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `storage.ts`                  | `saveAudio(id, recordedAt, bytes, mime) -> {path, bytes}`, `absolutePath(rel)`, `deleteAudio(rel)`, `probeDurationMs(abs) -> number \| null`                                                                                                                                                                                                                                                                                                                                     |
| `webhook-log.ts`              | `logWebhookEvent(event)` (never throws, keeps 200 + 50 rejected), `listWebhookEvents(limit)`, `errorSummary(e)`                                                                                                                                                                                                                                                                                                                                                                  |
| `index01/verify.ts`           | `verifyIndexWebhook(headers, raw, secret, {toleranceSec?, nowSec?})`                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ingest.ts`                   | `createRecording(input) -> {recording, duplicate}`; inserts row, stores audio, probes duration, calls `enqueue`; `deleteRecording(id) -> boolean`                                                                                                                                                                                                                                                                                                                                |
| `transcribe/index.ts`         | `transcribe(input, deps?) -> TranscribeResult`, `testTranscription(settings, deps?) -> string`, `PROVIDERS`                                                                                                                                                                                                                                                                                                                                                                      |
| `transcribe/*.ts`             | one file per provider, `audio.ts` (ffmpeg decode/encode), `chunk.ts` (pause chunker)                                                                                                                                                                                                                                                                                                                                                                                             |
| `integrations/index.ts`       | `kinds`, `listIntegrations()`/`getIntegration(id)` (secrets decrypted, env fallbacks applied, server only), `listIntegrationsForUI()`/`getIntegrationForUI(id)` (secrets blanked, `secretsSet`, `envSet`, `envValues`), `envFor(kind)`, `saveIntegration(input)`, `deleteIntegration(id) -> {deleted, recordingIds}`, `testIntegration(kind, config, id?, timeZone, clearSecrets?)`, `ensureEnvIntegrations()`, `integrationMatches(integration, trigger)`, `TRIGGERS`, `isKind` |
| `integrations/obsidian.ts`    | the `obsidian` `IntegrationKind`, MCP client                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `pipeline.ts`                 | `startWorker()`, `enqueue(id)`, `retryRecording(id, from)`, `redeliver(deliveryId)` (both return once queued, throw while the recording is busy), `settleAfterIntegrationDelete(recordingIds)`, `onChange(listener)`, `whenIdle()`, `isProcessing(id)`                                                                                                                                                                                                                           |
| `time.ts`                     | `formatDate(date, format, timeZone)` with tokens YYYY MM DD HH mm ss ddd dddd MMM MMMM                                                                                                                                                                                                                                                                                                                                                                                           |

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
transcript". No speech and no app transcript ends `done` with nothing delivered. A clip under
0.1 s counts as no speech; a file that decodes to nothing fails.

One transcription attempt gets as long as the recording (three times that for `whisper-cpp`), at
least 15 minutes and at most 6 hours. Running past it fails at once, with no retry. Recordings
over 2 hours fail without being decoded. Sound-event tags (`[Music]`, `(laughs)`), Whisper
segments marked as silence, and stock phrases Whisper writes for noise ("Thanks for watching",
or a run of outro lines like "Please subscribe and thumbs up. More videos to come") are dropped before the text counts as speech.

## Transcription

Settings live in the `transcription` settings row (`TranscriptionSettings` in `settings.ts`).
A stored row that names a provider no longer offered (`gemini`) loads with the default provider,
and fields of removed providers are dropped on read.

| Provider       | Call                                                                                                                  | Notes                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openai`       | `POST {baseUrl}/audio/transcriptions`                                                                                 | OpenAI `gpt-transcribe` (default) takes repeated `languages[]`, `prompt`; whisper-style models take one `language`. Works for Groq and speaches too |
| `openai-audio` | `POST {baseUrl}/chat/completions` with `input_audio`                                                                  | Audio piped into an LLM (`gpt-audio`). Strict verbatim prompt, JSON out `{text, languages}`                                                         |
| `whisper-cpp`  | `POST {url}/inference` multipart `file` (16 kHz wav), `language=auto` or the one hint, `response_format=verbose_json` | A whisper.cpp server hosted separately. No default URL: required when it is the provider                                                            |

Code-switched audio: no single `language` (it forces one), languages passed as hints where the
API supports a list, and the pause chunker (cuts at the longest pause between 15 and 30 s, 16 kHz
mono; each provider gets its own encoding: opus for openai, wav for openai-audio and
whisper-cpp) since providers drop sentences at language switches in long clips (toolbar
measured 34% to 15% WER on Swahili/English).

## Integrations

`integrations` rows hold `kind`, `name`, `enabled`, `triggers` (empty = all; values
`single-click-hold`, `double-click-hold`, `upload`) and `config` (secrets encrypted).

### Obsidian

Talks MCP (Streamable HTTP, `Authorization: Bearer <key>`) to either the headless
`obsidian-remote-rest-api` server, hosted separately, or the Local REST API plugin inside desktop
Obsidian (same `/mcp/` endpoint and tools). Neither knows about daily notes, so the path is
computed here.

Config: `url` (no default; env `OBSIDIAN_MCP_URL`), `apiKey` (env `OBSIDIAN_API_KEY`), `insecureTls` (plugin's self-signed
27124 cert), `notePath` (`{{date:YYYY-MM-DD}}.md`), `heading` (`Notes`), `entryTemplate`
(`- {{time:HH:mm}} {{transcript}}`), `newNoteTemplate` (`## {{heading}}\n`; a stored `## Notes\n`,
the old default, reads as the new one).

Env fallbacks: a field with `FieldSpec.env` that is stored blank takes that variable's value
wherever a config is used (`listIntegrations`, `getIntegration`, `testIntegration`, required-field
checks on save). A stored value overrides it. Saves never store env values. The browser gets
`envSet` (field to variable name) and `envValues` (non-secret values only, the URL for its
placeholder), never the env key. `integrations/env.ts` reads the variables from
`$app/env/private`. On start, `ensureEnvIntegrations()` (called from `hooks.server.ts` init after
migrations) creates an enabled **Daily note** Obsidian integration on every trigger with URL and
key blank, when `OBSIDIAN_MCP_URL` is set and no Obsidian integration exists.

Deliver: compute path in the general timezone from `recordedAt`, `vault_get_document_map`; if the
note is missing `vault_write` the new-note template; find the full heading path of `heading`
(paths are full: `["2026-10-22", "Notes"]`); read the section. An entry already there as whole
lines counts as delivered, so a retry whose entry landed writes nothing; a substring of a longer
entry does not count. When the entry template starts with a `{{time}}` token (after a literal
prefix such as `- `) and the note is one per day (or the time format holds the date), the entry
goes before the first top-level entry with a later time: `vault_patch` replace of the section with
`ifMatch` set to the map's version, so a hand edit in between fails the attempt and it retries.
Otherwise `vault_patch` appends with `createTargetIfMissing`, and a section ending in a list is
extended in place so entries stay one tight list. Deliveries to one note are serialised in process.
Each delivery and connection test opens one MCP session and ends it with a DELETE
(`terminateSession`, at most 5 s), since the server keeps sessions until then. `insecureTls` uses a
`node:https` fetch, since undici is not a dependency. A delivery's first attempt always writes
its entry, so two recordings with the same text in the same minute both land. A retry, a resumed
job or "Send again" skips an entry whose exact lines are already in the section.

Re-transcription: `recordings.transcript_version` goes up when the transcript text changes, and a
delivery stores the version it sent (`sent_version`). A new transcript leaves sent deliveries
alone; the recording page marks them Stale and offers "Send corrected transcript", which adds a
new entry and leaves the old one in the note. "Send again" on a sent delivery adds the entry only
if it is no longer in the note.

Deleting an integration cascades its deliveries; `settleAfterIntegrationDelete` then recomputes
the status and error of each failed recording that had one.

## UI

Herakraft UI kit (`src/lib/styles/hk-tokens.css`, from Heracraft/branding), with the journal
layout in `src/lib/styles/journal.css`. Routes:

- `/` is today, `/day/YYYY-MM-DD` any other day: the day's daily note "Notes" section as the vault
  has it, read through Obsidian (`journal.ts`, `readNote`, cached a few seconds and dropped on
  every pipeline change), with each recording matched to the line it wrote (`notes/merge.ts`).
  Lines typed in Obsidian show without audio. Failed recordings sit at their time with the cause
  and one fix; in-flight ones at the end. When Obsidian does not answer, the sheet shows the
  recordings alone. A month calendar (dots per day, red for a failure) and a "Not in a note" list
  sit beside it; under 900 px a week strip.
- `/recordings` searches every transcript and filters by `?status=` (failed, pending, done).
- `/recordings/[id]`: problem block with the cause, the raw error and one action when something
  failed, the player, the transcript (edit, copy, share), "In the note" with the line in its note,
  and Details with Transcribe again and Delete.
- `/settings`: Daily note (one section per integration), Transcription, Ring (webhook URL, secret,
  rejections), General (timezone, theme, sign out). A save bar appears once something changed.
  `/settings/requests` holds the webhook log. `/integrations`, `/transcription` and `/webhook`
  redirect there.

One shared `Audio` element plays every recording (`audio.svelte.ts`), so starting a line pauses
the last one. Live updates over SSE (`/events`) reload the page data; rows are keyed by id. The
header's upload button runs a file through the same pipeline without the ring.
