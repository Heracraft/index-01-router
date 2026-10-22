<script lang="ts">
	/* Copy with a check morph for 1.2 s and a polite "Copied" announcement. From the kit's
	   reference CopyButton; `tone="dark"` sits on a code pane. */
	interface Props {
		text: string | (() => string);
		label?: string;
		ariaLabel?: string;
		tone?: 'dark' | 'page';
		size?: 'sm' | 'md';
	}

	let { text, label, ariaLabel = 'Copy', tone = 'page', size = 'md' }: Props = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		const value = typeof text === 'function' ? text() : text;
		try {
			await navigator.clipboard.writeText(value);
		} catch {
			// Clipboard API refused (plain http on a LAN address): copy through a hidden textarea
			const ta = document.createElement('textarea');
			ta.value = value;
			ta.setAttribute('readonly', '');
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			ta.remove();
		}
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 1200);
	}
</script>

<button
	type="button"
	class="copy copy--{tone} copy--{size}"
	class:copy--labelled={label}
	class:is-copied={copied}
	onclick={copy}
	aria-label={label ? undefined : ariaLabel}
	title={label ? undefined : copied ? 'Copied' : ariaLabel}
>
	<span class="ic" aria-hidden="true">
		<svg
			class="i-copy"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="1.4"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<rect x="5.25" y="5.25" width="8" height="8" rx="1.75" />
			<path
				d="M10.75 5.25V4a1.75 1.75 0 0 0-1.75-1.75H4A1.75 1.75 0 0 0 2.25 4v5c0 .97.78 1.75 1.75 1.75h1.25"
			/>
		</svg>
		<svg
			class="i-check"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M3.5 8.5l3 3 6-7" pathLength="1" />
		</svg>
	</span>
	{#if label}
		<span class="text">
			<span class:off={copied}>{label}</span>
			<span class:off={!copied} aria-hidden="true">Copied</span>
		</span>
	{/if}
	<span class="hk-sr" aria-live="polite">{copied ? 'Copied' : ''}</span>
</button>

<style>
	.copy {
		position: relative;
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		border-radius: var(--hk-radius-6);
		border: 1px solid transparent;
		background: transparent;
		cursor: pointer;
		font: inherit;
		transition:
			color var(--hk-dur-fast) var(--hk-ease),
			background-color var(--hk-dur-fast) var(--hk-ease),
			border-color var(--hk-dur-fast) var(--hk-ease);
	}
	.copy--md {
		height: 1.75rem;
		min-width: 1.75rem;
		font-size: 0.8125rem;
	}
	.copy--sm {
		height: 1.5rem;
		min-width: 1.5rem;
		font-size: 0.75rem;
	}
	.copy--labelled {
		padding: 0 0.5rem;
	}
	.copy--dark {
		color: var(--hk-code-muted);
	}
	.copy--dark:hover {
		color: var(--hk-code-text);
		background: rgb(255 255 255 / 0.06);
	}
	.copy--dark.is-copied {
		color: var(--hk-code-ok);
	}
	.copy--page {
		color: var(--hk-text-3);
	}
	.copy--page:hover {
		color: var(--hk-text);
		background: var(--hk-hover);
	}
	.copy--page.copy--labelled {
		border-color: var(--hk-border);
		background: var(--hk-surface);
		color: var(--hk-text-2);
	}
	.copy--page.copy--labelled:hover {
		border-color: var(--hk-border-strong);
		color: var(--hk-text);
	}
	.copy--page.is-copied {
		color: var(--hk-ok);
	}
	.ic {
		position: relative;
		width: 0.9375rem;
		height: 0.9375rem;
		flex: none;
	}
	.ic svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		transition:
			opacity var(--hk-dur-icon) var(--hk-ease),
			transform var(--hk-dur) var(--hk-ease);
	}
	.i-check {
		opacity: 0;
		transform: scale(0.6);
	}
	.i-check path {
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		transition: stroke-dashoffset var(--hk-dur-draw) var(--hk-ease) 60ms;
	}
	.is-copied .i-copy {
		opacity: 0;
		transform: scale(0.6);
	}
	.is-copied .i-check {
		opacity: 1;
		transform: scale(1);
	}
	.is-copied .i-check path {
		stroke-dashoffset: 0;
	}
	.text {
		display: grid;
	}
	.text > span {
		grid-area: 1 / 1;
		text-align: center;
	}
	.text > .off {
		visibility: hidden;
	}
</style>
