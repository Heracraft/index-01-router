import { describe, expect, it } from 'vitest';
import { cleanError, describeRecording } from './recording-state.ts';

const rec = (over: Partial<Parameters<typeof describeRecording>[0]>) =>
	describeRecording({ status: 'done', error: null, transcript: 'Hello', attempts: 1, ...over });

describe('cleanError', () => {
	it('drops the prefix, the retry suffix and provider advice', () => {
		expect(
			cleanError(
				'Transcription failed: OpenAI 429: Rate limit reached for gpt-transcribe in organization on requests per min (RPM): Limit 50, Used 50. Please try again in 1.2s'
			)
		).toBe(
			'OpenAI 429: Rate limit reached for gpt-transcribe in organization on requests per min (RPM): Limit 50, Used 50'
		);
		expect(cleanError('OpenAI 503: The server is overloaded or not ready yet. Retrying')).toBe(
			'OpenAI 503: The server is overloaded or not ready yet'
		);
		expect(cleanError('Cannot reach http://127.0.0.1:27150/mcp/ (ETIMEDOUT). Retrying')).toBe(
			'Cannot reach http://127.0.0.1:27150/mcp/ (ETIMEDOUT)'
		);
		expect(cleanError('Cannot reach http://x/mcp/ (ETIMEDOUT)')).toBe(
			'Cannot reach http://x/mcp/ (ETIMEDOUT)'
		);
	});
});

describe('describeRecording', () => {
	it('reads a transcription failure into the slot', () => {
		const s = rec({
			status: 'failed',
			transcript: null,
			error: 'Transcription failed: The file is not audio ffmpeg can read'
		});
		expect(s.slot).toEqual({ kind: 'error', text: 'The file is not audio ffmpeg can read' });
		expect(s.other).toBeNull();
	});

	it('reads no speech', () => {
		const s = rec({ transcript: '', error: 'No speech in the recording' });
		expect(s.slot).toEqual({ kind: 'no-speech' });
		expect(s.other).toBeNull();
	});

	it('gives a skeleton while pending, and the retry from attempt 2', () => {
		expect(rec({ status: 'transcribing', transcript: null }).slot).toEqual({ kind: 'pending' });
		expect(rec({ status: 'transcribing', transcript: null }).retry).toBeNull();
		const s = rec({
			status: 'transcribing',
			transcript: null,
			attempts: 2,
			error: 'OpenAI 503: The server is overloaded or not ready yet. Retrying'
		});
		expect(s.retry).toEqual({
			attempt: 2,
			lastError: 'OpenAI 503: The server is overloaded or not ready yet'
		});
	});

	it('keeps a delivery summary out of `other`', () => {
		const s = rec({ status: 'failed', error: '1 of 1 delivery failed' });
		expect(s.slot).toEqual({ kind: 'text' });
		expect(s.other).toBeNull();
		expect(rec({ status: 'failed', error: '2 of 3 deliveries failed' }).other).toBeNull();
	});

	it('reads the fallback reason without the provider id', () => {
		const s = rec({ error: 'Used the app transcript: openai:gpt-transcribe heard no speech' });
		expect(s.fallbackReason).toBe('gpt-transcribe heard no speech');
		expect(s.other).toBeNull();
		const both = rec({
			status: 'failed',
			error: '1 of 1 delivery failed. Used the app transcript: OpenAI 429: Slow down'
		});
		expect(both.fallbackReason).toBe('OpenAI 429: Slow down');
		expect(both.other).toBeNull();
	});

	it('puts a routing failure in `other`', () => {
		const s = rec({ status: 'failed', error: 'Routing failed: connection lost' });
		expect(s.other).toBe('Routing failed: connection lost');
	});

	it('shows a failure with no transcript once, in the slot', () => {
		const s = rec({ status: 'failed', transcript: null, error: 'No audio and no transcript' });
		expect(s.slot).toEqual({ kind: 'error', text: 'No audio and no transcript' });
		expect(s.other).toBeNull();
	});

	it('reads list rows by their first line', () => {
		const s = describeRecording({ status: 'done', error: null, line: 'Hello', attempts: 1 });
		expect(s.slot).toEqual({ kind: 'text' });
	});
});
