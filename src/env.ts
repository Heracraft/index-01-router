import { defineEnvVars } from '@sveltejs/kit/env';
import { building } from '$app/env';

/** Required at runtime, tolerated as missing while `vite build` analyses the app. */
const required = (name: string) => (value: string | undefined) => {
	if (value) return value;
	if (building) return '';
	throw new Error(`${name} is not set`);
};
const optional = (value: string | undefined) => value || undefined;
const list = (value: string | undefined) =>
	(value ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);

export const variables = defineEnvVars({
	DATABASE_URL: { description: 'Postgres connection string', schema: required('DATABASE_URL') },
	DATA_DIR: {
		description: 'Where audio files are stored',
		schema: (value) => value || './data'
	},
	OIDC_ISSUER: {
		description: 'OIDC issuer URL, used for discovery',
		schema: (value) => {
			if (!value) {
				if (building) return '';
				throw new Error('OIDC_ISSUER is not set');
			}
			new URL(value);
			return value;
		}
	},
	OIDC_CLIENT_ID: { description: 'OIDC client ID', schema: required('OIDC_CLIENT_ID') },
	OIDC_CLIENT_SECRET: {
		description: 'OIDC client secret. Unset means a public client with PKCE',
		schema: optional
	},
	OIDC_SCOPES: {
		description: 'Space separated scopes',
		schema: (value) => value || 'openid profile email'
	},
	ALLOWED_EMAILS: {
		description:
			'Comma separated emails allowed to sign in. Empty allows any account of the issuer',
		schema: list
	},
	AUTH_SECRET: {
		description: 'Signs cookies and encrypts stored API keys. openssl rand -hex 32',
		schema: (value) => {
			if (building) return value ?? '';
			if (!value || value.length < 32)
				throw new Error('AUTH_SECRET must be at least 32 characters');
			return value;
		}
	},
	PUBLIC_URL: {
		description: 'Public origin, e.g. https://index.example.com. Used to show the webhook URL',
		schema: optional
	},
	INDEX01_WEBHOOK_SECRET: {
		description: 'Signing secret for Index 01 webhooks. Overrides the one generated in the UI',
		schema: optional
	},
	OPENAI_API_KEY: { description: 'Default key for OpenAI providers', schema: optional },
	GEMINI_API_KEY: { description: 'Default key for the Gemini provider', schema: optional },
	FFMPEG_PATH: { description: 'ffmpeg binary', schema: (value) => value || 'ffmpeg' },
	FFPROBE_PATH: { description: 'ffprobe binary', schema: (value) => value || 'ffprobe' }
});
