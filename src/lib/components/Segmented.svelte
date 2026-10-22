<script lang="ts" module>
	export interface SegmentOption<T extends string = string> {
		value: T;
		label: string;
	}
</script>

<script lang="ts" generics="T extends string">
	/* Pick one. Native radios under the labels, so a form posts it and arrow keys move between
	   options. The raised thumb slides; label weight never changes. From the kit's Segmented */
	interface Props {
		options: SegmentOption<T>[];
		value: T;
		name: string;
		label: string;
		size?: 'sm' | 'md';
		onchange?: (value: T) => void;
	}

	let { options, value = $bindable(), name, label, size = 'md', onchange }: Props = $props();

	const index = $derived(
		Math.max(
			0,
			options.findIndex((o) => o.value === value)
		)
	);
</script>

<div
	class="sg sg--{size}"
	role="radiogroup"
	aria-label={label}
	style:--n={options.length}
	style:--i={index}
>
	<span class="thumb" aria-hidden="true"></span>
	{#each options as opt (opt.value)}
		<label class:on={opt.value === value}>
			<input
				type="radio"
				{name}
				value={opt.value}
				checked={opt.value === value}
				onchange={() => {
					value = opt.value;
					onchange?.(opt.value);
				}}
			/>
			<span>{opt.label}</span>
		</label>
	{/each}
</div>

<style>
	.sg {
		position: relative;
		display: inline-grid;
		grid-template-columns: repeat(var(--n), minmax(0, 1fr));
		padding: 3px;
		border-radius: var(--hk-radius-9);
		background: var(--hk-surface-2);
		box-shadow: inset 0 0 0 1px var(--hk-hairline);
		max-width: 100%;
	}
	.thumb {
		position: absolute;
		top: 3px;
		bottom: 3px;
		left: 3px;
		width: calc((100% - 6px) / var(--n));
		transform: translateX(calc(var(--i) * 100%));
		border-radius: var(--hk-radius-6);
		background: var(--hk-surface);
		box-shadow:
			0 0 0 1px var(--hk-border),
			0 1px 2px rgb(0 0 0 / 0.06);
		transition: transform var(--hk-dur-slide) var(--hk-ease);
	}
	label {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		padding: 0 0.875rem;
		color: var(--hk-text-3);
		cursor: pointer;
		white-space: nowrap;
		border-radius: var(--hk-radius-6);
		transition: color var(--hk-dur-fast) var(--hk-ease);
		font-weight: 500;
		user-select: none;
	}
	.sg--md label {
		height: 1.875rem;
		font-size: 0.8125rem;
	}
	.sg--sm label {
		height: 1.5rem;
		font-size: 0.75rem;
		padding: 0 0.625rem;
	}
	label:hover,
	label.on {
		color: var(--hk-text);
	}
	label:has(input:focus-visible) {
		box-shadow: 0 0 0 2px var(--hk-accent);
	}
	label span {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
</style>
