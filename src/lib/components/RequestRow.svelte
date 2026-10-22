<script lang="ts">
	/* One webhook request: time, what came of it, its code or quiet tags, and the body size. The
	   Requests page and the Ring section's rejections draw it the same way */
	import { formatBytes } from '#lib/format.ts';

	interface Props {
		time: string;
		/** The recording it made: the whole row opens it */
		href?: string | null;
		/** What happened: the transcript's start, or the reason */
		lead: string;
		/** err: needs you now. dim: a reason, read and settled. muted: no words */
		tone?: 'err' | 'dim' | 'muted' | '';
		/** HTTP status, shown for anything but a 2xx */
		code?: number | null;
		/** Quiet facts after the lead: a non-default trigger, Duplicate, Unsigned */
		tags?: string[];
		bytes: number;
	}
	let { time, href = null, lead, tone = '', code = null, tags = [], bytes }: Props = $props();
</script>

<li class="rq" class:link={!!href}>
	{#if href}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller resolves it -->
		<a class="rq-t" {href}>{time}</a>
	{:else}
		<span class="rq-t">{time}</span>
	{/if}
	<span
		class="rq-l"
		class:err={tone === 'err'}
		class:dim={tone === 'dim'}
		class:muted={tone === 'muted'}>{lead.trim()}</span
	>
	<!-- Fixed columns, so tags, codes and sizes line up down the list -->
	<span class="rq-a"
		>{#each tags as t (t)}<span>{t}</span>{/each}</span
	>
	<span class="rq-c">{code ?? ''}</span>
	<span class="rq-s">{formatBytes(bytes) || '0 B'}</span>
</li>
