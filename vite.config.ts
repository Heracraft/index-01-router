import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				experimental: { async: true }
			},
			adapter: adapter({ out: 'build' }),
			// adapter-node 6 reads the origin only at build time. Unset (the Docker image), it comes
			// from the request and PROTOCOL_HEADER/HOST_HEADER. Set ORIGIN for `pnpm build` to serve
			// plain http without a proxy
			paths: { origin: process.env.ORIGIN || undefined },
			experimental: { remoteFunctions: true },
			// The Index 01 app posts multipart without an Origin header. SvelteKit's form CSRF check
			// would reject it, so it is off here and hooks.server.ts checks Origin for everything else.
			csrf: { trustedOrigins: ['*'] }
		})
	],
	test: {
		expect: { requireAssertions: true },
		environment: 'node',
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});
