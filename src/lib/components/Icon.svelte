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
		| 'arrow-left'
		| 'left'
		| 'right'
		| 'play'
		| 'pause'
		| 'retry'
		| 'gear'
		| 'search'
		| 'external'
		| 'edit'
		| 'share'
		| 'check'
		| 'plus'
		| 'eye';
</script>

<script lang="ts">
	/* 16px line icons, stroke 1.4, always next to a text label (kit rule) */
	interface Props {
		name: IconName;
		class?: string;
		size?: number;
	}
	let { name, class: cls = '', size = 16 }: Props = $props();
	const filled = $derived(name === 'play' || name === 'pause');
</script>

<svg
	class="icon ic {cls}"
	style:width="{size / 16}rem"
	style:height="{size / 16}rem"
	viewBox="0 0 16 16"
	fill={filled ? 'currentColor' : 'none'}
	stroke={filled ? 'none' : 'currentColor'}
	stroke-width={name === 'chevron' || name === 'close' || name === 'left' || name === 'right'
		? 1.5
		: 1.4}
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
	{:else if name === 'left'}
		<path d="M10 3.5 5.5 8l4.5 4.5" />
	{:else if name === 'right'}
		<path d="m6 3.5 4.5 4.5L6 12.5" />
	{:else if name === 'play'}
		<path d="M4.5 2.6v10.8L13.3 8z" />
	{:else if name === 'pause'}
		<rect x="3.75" y="2.75" width="3" height="10.5" rx="0.75" /><rect
			x="9.25"
			y="2.75"
			width="3"
			height="10.5"
			rx="0.75"
		/>
	{:else if name === 'retry'}
		<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v3h3" />
	{:else if name === 'gear'}
		<path
			d="M6.9 1.8h2.2l.35 1.7c.4.15.77.37 1.1.63l1.65-.55 1.1 1.9-1.3 1.15a4.6 4.6 0 0 1 0 1.27l1.3 1.15-1.1 1.9-1.65-.55c-.33.26-.7.48-1.1.63l-.35 1.7H6.9l-.35-1.7a4.4 4.4 0 0 1-1.1-.63l-1.65.55-1.1-1.9 1.3-1.15a4.6 4.6 0 0 1 0-1.27L2.7 5.5l1.1-1.9 1.65.55c.33-.26.7-.48 1.1-.63z"
		/><circle cx="8" cy="8" r="1.9" />
	{:else if name === 'search'}
		<circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" />
	{:else if name === 'external'}
		<path
			d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"
		/>
	{:else if name === 'edit'}
		<path d="M10.5 2.5l3 3L6 13H3v-3z" /><path d="M9 4l3 3" />
	{:else if name === 'share'}
		<path d="M8 2.5v8M5 5.5l3-3 3 3M3.5 8.5v4a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-4" />
	{:else if name === 'check'}
		<path d="M3.5 8.5l3 3 6-7" />
	{:else if name === 'plus'}
		<path d="M8 3v10M3 8h10" />
	{:else if name === 'eye'}
		<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle
			cx="8"
			cy="8"
			r="2"
		/>
	{/if}
</svg>

<style>
	.icon {
		flex: none;
	}
</style>
