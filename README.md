# index-01-router

Receives signed webhook recordings from the Pebble Index 01 ring, stores the audio, transcribes it
(code-switched speech included) and sends the transcript to your integrations. The first
integration appends each note under `## Notes` in your Obsidian daily note over MCP.

## How it works

```
Index 01 app ──POST multipart, HMAC signed──▶ /api/index01/webhook
                                                   │ verify signature, store audio, reply 200
                                                   ▼
                                     transcribe: openai | openai-audio | gemini | whisper-cpp
                                                   │
                                                   ▼
                                integrations: Obsidian daily note, "## Notes" section
```

One SvelteKit app (Node), one Postgres and a `/data` volume for audio. Two optional sidecars run
from the same compose file: `obsidian-rest` (a headless vault server with MCP) and `whisper`
(whisper.cpp for local transcription). The app signs you in through any OIDC provider.

## Deploy on Coolify

1. Push this repository to a Git host Coolify can read.
2. In Coolify: **New resource**, pick the repository, set **Build Pack** to **Docker Compose** and
   **Docker Compose Location** to `/compose.yaml`.
3. Under **Domains**, give the `app` service your domain with the internal port, for example
   `https://index.example.com:3000`. Coolify fills `SERVICE_URL_APP` from it.
4. Under **Environment Variables**, fill the required ones:
   - `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` for a confidential client (see
     [Sign-in](#sign-in-oidc)).
   - `ALLOWED_EMAILS`: your email. The app refuses to start without it. `*` lets every account
     at the issuer in.
   - `TZ`: your zone, for example `Africa/Nairobi`. Daily note dates use it unless you pick
     another zone on the Transcription page.
   - `OPENAI_API_KEY` or `GEMINI_API_KEY`, or set keys later in the UI.
   - `COMPOSE_PROFILES`: `obsidian`, `whisper`, or `obsidian,whisper` to start the sidecars.
   - `OBSIDIAN_API_KEY` when you run `obsidian-rest`: `openssl rand -hex 32`.

   Coolify generates `SERVICE_USER_POSTGRES`, `SERVICE_PASSWORD_POSTGRES` and
   `SERVICE_HEX_64_AUTHSECRET` ([magic variables](https://coolify.io/docs/knowledge-base/docker/compose)).
   Keep `SERVICE_HEX_64_AUTHSECRET` stable: it signs sessions and encrypts the API keys and
   webhook secret stored in the database. See [Rotating AUTH_SECRET](#rotating-auth_secret).

5. Deploy. The app applies database migrations on start. `https://index.example.com/healthz`
   answers `ok` once it can reach Postgres.
6. Sign in, open **Webhook**, and copy the URL and signing secret into the Index 01 app.

If the sidecars do not start, set **Custom Start Command** to
`docker compose --profile obsidian up -d` (add `--profile whisper` as needed).

Without Coolify, put the same variables, including the three `SERVICE_*` values, in a `.env` file
next to `compose.yaml`, then run `docker compose up -d` behind a TLS proxy that sets
`X-Forwarded-Proto`. The image trusts `X-Forwarded-Proto`, `X-Forwarded-Host` and
`X-Forwarded-For`, so do not publish port 3000 to the internet directly.

## Index 01 app

In the Index 01 app: **Settings**, **Webhook**, then for each gesture you want to route
(**Hold & talk** or **Double click & hold**):

1. **URL**: `https://index.example.com/api/index01/webhook`.
2. Turn on **Sign requests** and paste the secret from this app's **Webhook** page.
3. Payload: **Recording only**. The app sends it as soon as the audio is on the phone, and this
   router does its own transcription. **Both** also works and stores the phone's transcript next
   to yours, but the app holds the webhook until its own transcription succeeds.
4. **Send test event**, then **Save**. **Recent runs** should show `200 OK`.

The gesture's routing in the Index 01 app must be something other than **Nothing**, or no
webhook fires. Each gesture keeps its own secret; paste the same one into both.

## Sign-in (OIDC)

Register a client at your provider (Pocket ID, Authentik, Keycloak, Authelia, Google):

- Redirect URI: `https://index.example.com/auth/callback`.
- Scopes: `openid profile email`.
- Either a public client with PKCE (leave `OIDC_CLIENT_SECRET` empty) or a confidential client
  (set `OIDC_CLIENT_SECRET`). PKCE is used in both cases.
- Post-logout redirect URI: `https://index.example.com/auth/signin`. Sign-out also ends the
  session at the provider when it has an end-session endpoint.
- `OIDC_ISSUER` is the issuer URL without `/.well-known/openid-configuration`. The app container
  must be able to reach it.

`ALLOWED_EMAILS` trusts the provider to verify emails. Sign-in fails when the provider marks the
email unverified, and with `OIDC_REQUIRE_VERIFIED_EMAIL=true` also when it sends no flag. If
anyone can register at your provider, close registration or set `ALLOWED_SUBS` to your subject
ID (the `sub` claim). It is checked on top of `ALLOWED_EMAILS`; set `ALLOWED_EMAILS=*` to rely on
`ALLOWED_SUBS` alone.

Removing an email from `ALLOWED_EMAILS` signs that account out on its next request. **Sign out
everywhere** in the account menu ends every session on every device.

### Rotating AUTH_SECRET

A new `AUTH_SECRET` signs everyone out. Stored API keys it can no longer decrypt read as blank:
the app shows a banner and asks for them again, and it replaces the webhook signing secret, which
you then paste into the Index 01 app. To keep them, put the old value in `AUTH_SECRET_PREVIOUS`
(comma separated for several). On start the app stores each value again under the new secret,
so you can remove `AUTH_SECRET_PREVIOUS` after that first start.

## Obsidian

The Obsidian integration speaks MCP to the Local REST API. You have two ways to run that.

**Headless, on the server.** Enable the `obsidian` profile. The `obsidian-rest` container
([Heracraft/obsidian-remote-rest-api](https://github.com/Heracraft/obsidian-remote-rest-api))
serves the vault in the `vault` volume without Obsidian itself. Get your vault into that volume
with Obsidian Sync, Syncthing or git, or replace the volume with a bind mount of a folder that a
sync tool already keeps current. The container runs as uid 1000, so that folder must be writable
by uid 1000. In the integration form use:

- URL `http://obsidian-rest:27123/mcp/`
- API key: the value of `OBSIDIAN_API_KEY`

**Desktop Obsidian.** Install the **Local REST API** community plugin in Obsidian, turn on its MCP
server, and copy the API key from the plugin settings. The URL is
`https://<computer>:27124/mcp/` (tick **Accept a self-signed certificate**) or
`http://<computer>:27123/mcp/` with the plugin's insecure server on. The server must reach that
computer, for example over Tailscale, and notes only arrive while Obsidian is open.

Neither server reads Obsidian's daily note settings, so set the note path (default
`{{date:YYYY-MM-DD}}.md`) and heading (`Notes`) in the integration to match your vault.

## Transcription

Pick the provider on the **Transcription** page. Add language hints there (for example `sw, en`)
when you mix languages.

| Provider       | Endpoint                                  | Key                        | Notes                                                                                                 |
| -------------- | ----------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `openai`       | `POST /audio/transcriptions`              | `OPENAI_API_KEY` or the UI | Default `gpt-transcribe`. Any OpenAI-compatible server works by changing the base URL: Groq, speaches |
| `openai-audio` | `POST /chat/completions` with audio input | `OPENAI_API_KEY` or the UI | `gpt-audio` with a verbatim prompt. Returns detected languages                                        |
| `gemini`       | `generateContent`                         | `GEMINI_API_KEY` or the UI | `gemini-3.8-flash` by default. `gemini-3.5-flash-lite` costs less                                     |
| `whisper-cpp`  | `POST /inference`                         | none                       | Local, profile `whisper`, URL `http://whisper:8080`. Audio stays on your server                       |

The `whisper` container downloads `WHISPER_MODEL` (default `base`, 148 MB) into its volume on
first start and runs on `WHISPER_THREADS` CPU threads. `small` is more accurate and about three
times slower. Whisper models detect one language per 30 seconds, so on mixed-language audio
they do worse than the hosted providers; the app cuts long recordings at pauses to limit that.

If `whisper` restart-loops after a first start that was cut off, remove the model volume and
start it again: `docker compose rm -sf whisper && docker volume rm <project>_whisper-models`.

Google serves the Gemini 2.5 models only to keys that used them before. Recordings over 2 hours
are not transcribed.

## Local development

Needs Node 24, pnpm, Docker and ffmpeg.

```sh
pnpm install
cp .env.example .env            # then set AUTH_SECRET: openssl rand -hex 32
pnpm db:up                      # Postgres on 5432, mock OIDC on 8090
pnpm dev                        # http://localhost:5173, any username signs in (ALLOWED_EMAILS="*")
```

Optional services from `compose.dev.yaml`:

- `pnpm obsidian:up`: vault server on `http://localhost:27123/mcp/`, key `devkey`, vault in
  `./data/vault`.
- `pnpm whisper:up`: whisper.cpp on `http://localhost:8080`.

The dev compose project is `index-01-router-dev`. Containers started before it got that name
belong to `index-01-router`; move them once (the volumes stay):

```sh
docker compose -p index-01-router -f compose.dev.yaml down
pnpm db:up
```

`pnpm test` runs the unit tests and `pnpm check` the type checker. `pnpm docker:build` builds the
production image. After changing `src/lib/server/db/schema.ts`, run `pnpm db:generate` and
commit the new file in `drizzle/`; the app applies it on the next start.

To run the production build without a proxy in front, set `ORIGIN` when you build. adapter-node
reads it only at build time; without it the app assumes https when no `X-Forwarded-Proto`
arrives, and form posts fail with 403. `node --env-file=.env` loads `PORT`, `BODY_SIZE_LIMIT`
and the rest of `.env`, and variables set on the command line win over it:

```sh
ORIGIN=http://localhost:3000 pnpm build
PUBLIC_URL=http://localhost:3000 node --env-file=.env build
```

The Docker image is built without `ORIGIN` and takes the origin from the proxy headers.
