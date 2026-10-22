import { defineEnvVars } from '@sveltejs/kit/env';
import { building } from '$app/env';

/** Required at runtime, tolerated as missing while `vite build` analyses the app. */
const required = (name: string) => (value: string | undefined) => {
	if (value) return value;
	if (building) return '';
	throw new Error(`${name} is not set`);
};
const optional = (value: string | undefined) => value || undefined;
const split = (value: string | undefined) =>
	(value ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
const list = (value: string | undefined) => split(value).map((s) => s.toLowerCase());
const isZone = (value: string) => {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: value });
		return true;
	} catch {
		return false;
	}
};

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
			'Comma separated emails allowed to sign in. "*" allows any account of the issuer. Required',
		schema: (value) => {
			const emails = list(value);
			if (emails.length || building) return emails;
			throw new Error(
				'ALLOWED_EMAILS is not set. List your email, or set "*" to allow any account of the issuer'
			);
		}
	},
	ALLOWED_SUBS: {
		description:
			'Comma separated OIDC subject IDs allowed to sign in, checked on top of ALLOWED_EMAILS',
		schema: split
	},
	OIDC_REQUIRE_VERIFIED_EMAIL: {
		description: 'Deny sign-in unless the issuer marks the email as verified',
		schema: (value) => value === 'true' || value === '1'
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
	AUTH_SECRET_PREVIOUS: {
		description:
			'Comma separated earlier AUTH_SECRET values. Stored keys encrypted with them still decrypt',
		schema: split
	},
	PUBLIC_URL: {
		description:
			'Public origin, e.g. https://index.example.com. Used for the webhook URL, the sign-in callback and the same-origin check',
		schema: optional
	},
	INDEX01_WEBHOOK_SECRET: {
		description: 'Signing secret for Index 01 webhooks. Overrides the one generated in the UI',
		schema: optional
	},
	OPENAI_API_KEY: { description: 'Default key for OpenAI providers', schema: optional },
	OBSIDIAN_MCP_URL: {
		description: 'MCP endpoint of the Obsidian REST server, e.g. https://vault.example.com/mcp/',
		schema: (value) => {
			if (!value) return undefined;
			let url: URL | undefined;
			try {
				url = new URL(value);
			} catch {
				// reported below
			}
			if (url?.protocol === 'http:' || url?.protocol === 'https:' || building) return value;
			throw new Error(`OBSIDIAN_MCP_URL: ${value} is not an http(s) URL`);
		}
	},
	OBSIDIAN_API_KEY: {
		description: 'Bearer key of the Obsidian REST server at OBSIDIAN_MCP_URL',
		schema: optional
	},
	FFMPEG_PATH: { description: 'ffmpeg binary', schema: (value) => value || 'ffmpeg' },
	FFPROBE_PATH: { description: 'ffprobe binary', schema: (value) => value || 'ffprobe' },
	TZ: {
		description: 'IANA zone for daily note dates, unless the Transcription page sets another',
		schema: (value) => {
			if (!value) return 'UTC';
			if (isZone(value) || building) return value;
			throw new Error(`TZ: ${value} is not an IANA zone such as Africa/Nairobi`);
		}
	}
});
