import { describe, expect, it } from 'vitest';
import { deliveryCause, rawError, transcribeCause } from './causes.ts';

describe('causes', () => {
	it('names transcription failures in a few words', () => {
		expect(
			transcribeCause(
				'Transcription failed: OpenAI 429: Rate limit reached for gpt-transcribe in organization org-k2Vb8sQ'
			)
		).toBe('Rate limited by OpenAI');
		expect(
			transcribeCause(
				'Transcription failed: OpenAI 400: Audio file might be corrupted or unsupported'
			)
		).toBe('Audio unreadable');
		expect(transcribeCause('OpenAI 503: The server is overloaded')).toBe('OpenAI is down');
		expect(transcribeCause(null)).toBe('Not transcribed');
	});

	it('names delivery failures', () => {
		expect(deliveryCause('Obsidian did not answer in time')).toBe("Obsidian didn't answer");
		expect(deliveryCause('Cannot reach http://x/mcp/ (ECONNREFUSED)')).toBe('Obsidian unreachable');
	});

	it('masks the org id in the raw error', () => {
		expect(rawError('OpenAI 429: limit in organization org-k2Vb8sQ on requests')).toBe(
			'OpenAI 429: limit in organization org-… on requests'
		);
	});
});
