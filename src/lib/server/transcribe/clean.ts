// Post-filters for Whisper-style output: sound-event tags, segments Whisper itself marks as
// non-speech, and the stock phrases Whisper invents for noise.
import type { ChunkReply } from './types.ts';

/** Words inside *...* that name a sound rather than spoken words */
const SOUND_WORDS =
	/music|laugh|applause|noise|silence|inaudible|cough|sigh|breath|static|clap|beep|wind|motor|engine|sound/i;

/**
 * Drops sound-event tags: every [..] tag, short (..) tags of up to 4 words, *sound* tags and
 * music notes with what they enclose. Empty when no letters or digits remain.
 */
export function cleanTranscriptText(text: string): string {
	const out = text
		.replace(/\[[^\]\n]*\]/g, ' ')
		.replace(/\(\s*[^()\s]+(?:\s+[^()\s]+){0,3}\s*\)/g, ' ')
		.replace(/\*([^*\n]{1,40})\*/g, (m, inner: string) => (SOUND_WORDS.test(inner) ? ' ' : m))
		.replace(/[♪♫♬♩][^♪♫♬♩\n]*[♪♫♬♩]/g, ' ')
		.replace(/[♪♫♬♩]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return /[\p{L}\p{N}]/u.test(out) ? out : '';
}

export interface Segment {
	text?: unknown;
	no_speech_prob?: unknown;
	avg_logprob?: unknown;
	compression_ratio?: unknown;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Whisper's own rule: a segment is silence when no_speech_prob > 0.6 and avg_logprob < -1. A
 * compression ratio above 2.4 marks a repetition loop.
 */
export function keepSegment(s: Segment): boolean {
	const nsp = num(s.no_speech_prob);
	const alp = num(s.avg_logprob);
	const cr = num(s.compression_ratio);
	if (nsp !== null && alp !== null && nsp > 0.6 && alp < -1) return false;
	return !(cr !== null && cr > 2.4);
}

/**
 * Text of a verbose_json reply with non-speech segments left out, and the highest
 * no_speech_prob among the kept ones. Null without a segments array.
 */
export function textFromSegments(
	segments: unknown,
	fullText: string
): { text: string; noSpeech?: number } | null {
	if (!Array.isArray(segments) || !segments.length) return null;
	const all = segments.filter((s): s is Segment => !!s && typeof s === 'object');
	const kept = all.filter(keepSegment);
	const probs = kept.map((s) => num(s.no_speech_prob)).filter((p): p is number => p !== null);
	const noSpeech = probs.length ? Math.max(...probs) : undefined;
	const text =
		kept.length === all.length
			? fullText
			: kept
					.map((s) => (typeof s.text === 'string' ? s.text : ''))
					.join('')
					.replace(/\s+/g, ' ')
					.trim();
	return noSpeech === undefined ? { text } : { text, noSpeech };
}

const normalize = (s: string) =>
	s
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[\p{P}\p{S}]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();

/** Phrases Whisper writes for noise that a voice note may also hold: dropped only on doubt */
const DOUBTFUL = ['thank you', 'thank you very much', 'thanks', 'you', 'bye', 'okay'].map(
	normalize
);

/** Phrases from video outros that dictation does not produce: dropped whenever whole */
const NEVER = [
	'thanks for watching',
	'thank you for watching',
	'thank you so much for watching',
	'please subscribe',
	'ご視聴ありがとうございました',
	'продолжение следует',
	'请不吝点赞 订阅 转发 打赏支持明镜与点点栏目'
].map(normalize);

/**
 * Sentences of a video outro in looser wording, matched against normalized text: "Please
 * subscribe and Thumbs Up", "More videos to come", "See you in the next video"
 */
const OUTRO =
	/^(?:(?:thanks|thank you)(?: so much| very much)? for (?:watching|listening)(?: and (?:please )?(?:like|subscribe)\b.*)?|(?:please |don t forget to |make sure to )?(?:like and )?subscribe(?: and (?:like|thumbs? up|share|comment)\b.*| to (?:my|our|the|this) channel\b.*)?|(?:please )?(?:give (?:it|us|me) a )?thumbs? up(?: and (?:like|subscribe|share|comment)\b.*)?|(?:many |lots of )?more videos? (?:to come|coming soon|soon)|see you (?:in the |on the )?next (?:video|episode|time))$/;

/** True when every sentence of `text` is an outro phrase, as in a run of them */
function allOutro(text: string): boolean {
	const sentences = text
		.normalize('NFKC')
		.split(/[.!?\u2026\n]+/)
		.map(normalize)
		.filter(Boolean);
	return sentences.length > 0 && sentences.every((s) => NEVER.includes(s) || OUTRO.test(s));
}

/**
 * Subtitle credit lines such as "Sous-titrage Société Radio-Canada": one of these openings and a
 * known credit source
 */
const CREDITS = [
	'subtitles by',
	'sous titrage',
	'sous titres',
	'untertitel',
	'ondertiteling',
	'sottotitoli',
	'subtítulos',
	'legendas',
	'субтитры',
	'字幕'
].map(normalize);
const CREDIT_SOURCE =
	/amara|radio canada|zdf|dimatorzok|st 501|community|communauté|comunidad|comunità|gemeenschap|社区/;

/**
 * True when a chunk's whole text is a stock Whisper hallucination. Subtitle credits and runs of
 * video outro sentences always count. "Thank you" and the like count only when segments show doubt (max no_speech_prob
 * above 0.3), so a clearly spoken one survives.
 */
export function isHallucination(reply: Pick<ChunkReply, 'text' | 'noSpeech'>): boolean {
	const t = normalize(reply.text);
	if (!t) return false;
	if (NEVER.includes(t) || (CREDITS.some((c) => t.startsWith(c)) && CREDIT_SOURCE.test(t)))
		return true;
	if (allOutro(reply.text)) return true;
	return DOUBTFUL.includes(t) && reply.noSpeech !== undefined && reply.noSpeech > 0.3;
}
