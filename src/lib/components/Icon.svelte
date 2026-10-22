<script lang="ts" module>
	export type IconName =
		| 'recordings'
		| 'integrations'
		| 'transcription'
		| 'webhook'
		| 'single'
		| 'double'
		| 'upload'
		| 'test'
		| 'lock'
		| 'chevron'
		| 'close'
		| 'arrow-left';
</script>

<script lang="ts">
	/* 16px line icons, stroke 1.4, always next to a text label (kit rule) */
	interface Props {
		name: IconName;
		class?: string;
	}
	let { name, class: cls = '' }: Props = $props();
</script>

<svg
	class="icon {cls}"
	viewBox="0 0 16 16"
	fill="none"
	stroke="currentColor"
	stroke-width={name === 'chevron' || name === 'close' ? 1.5 : 1.4}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if name === 'recordings'}
		<path d="M2.5 8h1.5M5.5 5v6M8 3v10M10.5 5.5v5M13.5 8H12" />
	{:else if name === 'integrations'}
		<rect x="2" y="2.5" width="5" height="5" rx="1" /><rect
			x="9"
			y="8.5"
			width="5"
			height="5"
			rx="1"
		/>
		<path d="M7 5h2.5a2 2 0 0 1 2 2v1.5M9 11H6.5a2 2 0 0 1-2-2V7.5" />
	{:else if name === 'transcription'}
		<path d="M2.5 4h11M2.5 7h8M2.5 10h11M2.5 13h6" />
	{:else if name === 'webhook'}
		<path d="M6 5.5a2.5 2.5 0 1 1 3.9 2.1L8 11" /><path
			d="M5.2 13.4A2.5 2.5 0 1 1 4 8.9l2 3.1"
		/><path d="M10.5 13.5a2.5 2.5 0 1 0 0-5H8" />
	{:else if name === 'single'}
		<circle cx="8" cy="8" r="5.5" /><circle
			cx="8"
			cy="8"
			r="1.5"
			fill="currentColor"
			stroke="none"
		/>
	{:else if name === 'double'}
		<circle cx="8" cy="8" r="5.5" /><circle
			cx="6.25"
			cy="8"
			r="1.25"
			fill="currentColor"
			stroke="none"
		/><circle cx="9.75" cy="8" r="1.25" fill="currentColor" stroke="none" />
	{:else if name === 'upload'}
		<path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v2a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-2" />
	{:else if name === 'test'}
		<path
			d="M6 2.5h4M6.75 2.5v4L3 12.5a.75.75 0 0 0 .65 1.1h8.7a.75.75 0 0 0 .65-1.1L9.25 6.5v-4"
		/><path d="M4.75 10h6.5" />
	{:else if name === 'lock'}
		<rect x="3" y="7" width="10" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
	{:else if name === 'chevron'}
		<path d="M4 6l4 4 4-4" />
	{:else if name === 'close'}
		<path d="M4 4l8 8M12 4l-8 8" />
	{:else if name === 'arrow-left'}
		<path d="M13 8H3M7 4L3 8l4 4" />
	{/if}
</svg>

<style>
	.icon {
		width: 1rem;
		height: 1rem;
		flex: none;
	}
</style>
