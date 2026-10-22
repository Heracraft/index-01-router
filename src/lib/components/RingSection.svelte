<script lang="ts">
	import { resolve } from '$app/paths';
	/* The ring's webhook: URL, signing secret, the unsigned switch, and only the rejections */
	import { enhance } from '$app/forms';
	import ConfirmAction from './ConfirmAction.svelte';
	import CopyButton from './CopyButton.svelte';
	import Icon from './Icon.svelte';
	import SaveBar from './SaveBar.svelte';
	import Switch from './Switch.svelte';
	import { sectionSubmit } from './section-submit.ts';
	import type { DirtyForms } from './dirty.svelte.ts';
	import { dayKey, formatBytes, formatDay, formatTime } from '#lib/format.ts';

	interface Props {
		ring: {
			webhookUrl: string;
			total: number;
			rejected: { id: string; at: Date; status: number; reason: string; bytes: number }[];
			last: { at: Date; status: number; reason: string; test: boolean } | null;
			rotatedAt: string | null;
			secretLocked: boolean;
			secretHint: string;
			requireSignature: boolean;
		};
		/** Secret returned by Reveal or Rotate */
		revealed: string | null;
		timezone: string;
		dirty: DirtyForms;
	}
	let { ring, revealed, timezone: tz, dirty }: Props = $props();

	const masked = $derived('•'.repeat(16) + ring.secretHint);
	let revealing = $state(false);
	const when = (d: Date) =>
		dayKey(d, tz) === dayKey(new Date(), tz)
			? formatTime(d, tz)
			: `${formatDay(d, tz)}, ${formatTime(d, tz)}`;
	const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
	const waiting = $derived(
		!!ring.rotatedAt && (!ring.last || new Date(ring.rotatedAt) > new Date(ring.last.at))
	);
	const submit = $derived(sectionSubmit(dirty, 'ring', { result: () => {} }));
</script>

<section class="sset" id="ring" aria-labelledby="ring-h">
	<div class="sset-h">
		<h2 class="sec-h" id="ring-h">Ring</h2>
		<span class="sset-s" role="status">
			{#if waiting}
				<span class="dot warn" aria-hidden="true"></span>Waiting for a signed request
			{:else if ring.last && ring.last.status < 300}
				<span class="dot" aria-hidden="true"></span>Last request {when(ring.last.at)}
			{:else if ring.last}
				<span class="dot err" aria-hidden="true"></span>Rejected {when(ring.last.at)}
			{:else}
				<span class="dot idle" aria-hidden="true"></span>No requests yet
			{/if}
		</span>
	</div>

	<div class="f">
		<span class="hk-field-label" id="url-label">Webhook URL</span>
		<div class="hk-secret" aria-labelledby="url-label">
			<span class="scroll url">{ring.webhookUrl}</span>
			<CopyButton text={ring.webhookUrl} label="Copy" />
		</div>
	</div>

	<div class="f">
		<span class="hk-field-label" id="secret-label">Signing secret</span>
		<div class="hk-secret" aria-labelledby="secret-label">
			{#if ring.secretLocked}
				<span class="env" title="INDEX01_WEBHOOK_SECRET"
					><Icon name="lock" size={12} />Set on the server</span
				>
			{/if}
			<span class="scroll" class:dim={!revealed}>{revealed ?? masked}</span>
			{#if revealed}
				<CopyButton text={revealed} label="Copy" />
			{:else}
				<form
					method="POST"
					action="/settings?/reveal"
					use:enhance={() => {
						revealing = true;
						return async ({ update }) => {
							await update({ refreshAll: false });
							revealing = false;
						};
					}}
				>
					<button class="hk-btn-ghost hk-btn-sm" aria-busy={revealing} disabled={revealing}
						><Icon name="eye" size={14} />Reveal</button
					>
				</form>
			{/if}
			{#if !ring.secretLocked}
				<ConfirmAction
					action="/settings?/rotate"
					label="Rotate"
					title="Rotate signing secret"
					triggerClass="hk-btn-ghost hk-btn-sm"
					confirmLabel="Rotate secret"
				>
					<p>Requests signed with <span class="hk-mono">…{ring.secretHint}</span> get 401.</p>
				</ConfirmAction>
			{/if}
		</div>
	</div>

	<form
		method="POST"
		action="/settings?/signature"
		use:enhance={submit}
		use:dirty.track={{ key: 'ring', label: 'Ring' }}
	>
		<div class="srow srow--top">
			<span class="srow-l">Reject unsigned requests</span>
			<Switch
				name="requireSignature"
				checked={ring.requireSignature}
				label="Reject unsigned requests"
			/>
		</div>
	</form>
	<SaveBar {dirty} keys={['ring']} />

	{#if ring.rejected.length}
		<h3 class="sub">Rejected <span class="cnt">{ring.rejected.length}</span></h3>
		<ul class="rej">
			{#each ring.rejected.slice(0, 6) as e (e.id)}
				<li>
					<span class="r-t">{when(e.at)}</span>
					<span class="r-m">{capital(e.reason)}</span>
					<span class="obadge err">{e.status}</span>
					<span class="r-s">{e.bytes ? formatBytes(e.bytes) : ''}</span>
				</li>
			{/each}
		</ul>
	{/if}
	{#if ring.total}
		<a class="hk-link small" href={resolve('/(app)/settings/requests')}>All {ring.total} requests</a
		>
	{/if}
</section>

<style>
	.dim {
		color: var(--hk-text-3);
		letter-spacing: 0.05em;
	}
	.env {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		flex: none;
		font-size: 0.75rem;
		color: var(--hk-text-3);
	}
	.small {
		font-size: 0.875rem;
	}
	/* Read-only field: the input's height, surface-2, actions inside on the right */
	.hk-secret {
		height: 2.25rem;
		padding: 0 0.25rem 0 0.75rem;
		gap: 0.25rem;
	}
	.hk-secret :global(.hk-btn-ghost) {
		height: 1.75rem;
		padding: 0 0.5rem;
	}
	/* Copy, Reveal and Rotate inside a field: one bare ghost style */
	.hk-secret :global(.copy.copy--labelled) {
		height: 1.75rem;
		padding: 0 0.5rem;
		gap: 0.375rem;
		border-color: transparent;
		background: transparent;
		color: var(--hk-text-2);
		font-family: var(--hk-font-sans);
		font-weight: 500;
	}
	.hk-secret :global(.copy.copy--labelled:hover) {
		background: var(--hk-hover);
		color: var(--hk-text);
	}
	.hk-secret :global(.copy .ic) {
		width: 14px;
		height: 14px;
	}
	.url {
		word-break: normal;
	}
</style>
