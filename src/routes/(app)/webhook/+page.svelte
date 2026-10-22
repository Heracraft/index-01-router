<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import ConfirmAction from '#lib/components/ConfirmAction.svelte';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import PageHead from '#lib/components/PageHead.svelte';
	import Trigger from '#lib/components/Trigger.svelte';
	import { dayKey, formatBytes, formatDay, formatTime, httpTone } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const tz = $derived(data.timezone);
	const revealed = $derived(form && 'secret' in form && form.secret ? form.secret : null);
	const masked = $derived('•'.repeat(20) + data.secretHint);
	let revealing = $state(false);

	// Date only on the first row of each day
	const rows = $derived(
		data.events.map((e, i) => ({
			...e,
			showDay: i === 0 || dayKey(e.at, tz) !== dayKey(data.events[i - 1].at, tz)
		}))
	);
</script>

<PageHead title="Webhook" />

{#if form && 'error' in form && form.error}
	<p class="hk-banner hk-banner--err" role="alert">{form.error}</p>
{/if}

<div class="hk-fields">
	<div>
		<span class="hk-field-label" id="url-label">URL</span>
		<div class="hk-secret" aria-labelledby="url-label">
			<span>{data.webhookUrl}</span>
			<CopyButton text={data.webhookUrl} label="Copy" />
		</div>
	</div>

	<div>
		<span class="hk-field-label" id="secret-label">Signing secret</span>
		<div class="hk-secret" aria-labelledby="secret-label">
			{#if data.secretLocked}
				<span class="lock" title="Set by INDEX01_WEBHOOK_SECRET"><Icon name="lock" /></span>
			{/if}
			<span class:dim={!revealed}>{revealed ?? masked}</span>
			{#if revealed}
				<CopyButton text={revealed} label="Copy" />
			{:else}
				<form
					method="POST"
					action="?/reveal"
					use:enhance={() => {
						revealing = true;
						return async ({ update }) => {
							await update({ refreshAll: false });
							revealing = false;
						};
					}}
				>
					<button class="hk-btn-ghost hk-btn-sm" aria-busy={revealing} disabled={revealing}>
						Reveal
					</button>
				</form>
			{/if}
		</div>
		<div class="secret-foot">
			{#if data.secretLocked}
				<span class="env">From <span class="hk-mono">INDEX01_WEBHOOK_SECRET</span></span>
			{:else}
				<ConfirmAction
					action="?/rotate"
					label="Rotate secret"
					title="Rotate signing secret"
					triggerClass="hk-btn-secondary hk-btn-sm"
					confirmLabel="Rotate secret"
				>
					<p>
						Replace the signing secret ending in <span class="hk-mono">{data.secretHint}</span>? The
						ring app gets 401 until you paste the new one into it.
					</p>
				</ConfirmAction>
			{/if}
		</div>
	</div>

	<form
		method="POST"
		action="?/signature"
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
	>
		<label class="hk-check">
			<input
				type="checkbox"
				name="requireSignature"
				checked={data.requireSignature}
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
			/>
			Reject unsigned requests
		</label>
	</form>
</div>

<section>
	<div class="sec-head">
		<h2>Recent requests</h2>
	</div>

	{#if rows.length === 0}
		<div class="hk-empty-row"><span>No requests yet.</span></div>
	{:else}
		<ul class="log" aria-label="Recent webhook requests">
			<li class="log-head" aria-hidden="true">
				<span>Time</span><span>Status</span><span>Trigger</span><span>Delivery</span><span
					class="num">Size</span
				><span>Result</span>
			</li>
			{#each rows as e (e.id)}
				<li class="log-row">
					<span class="time hk-num">
						{#if e.showDay}<span class="day">{formatDay(e.at, tz)}</span>{/if}
						{formatTime(e.at, tz, true)}
					</span>
					<span class="status">
						<span class="hk-badge hk-badge--mono hk-badge--{httpTone(e.status)}">{e.status}</span>
					</span>
					<span class="trigger">
						<Trigger trigger={e.test ? 'test-event' : e.trigger} />
					</span>
					<span class="delivery hk-mono">
						{#if e.recordingId}
							<a href={resolve('/(app)/recordings/[id]', { id: e.recordingId })}
								>{e.deliveryId ?? 'Recording'}</a
							>
						{:else}
							{e.deliveryId ?? ''}
						{/if}
					</span>
					<span class="bytes num hk-num">{e.bytes ? formatBytes(e.bytes) : ''}</span>
					<span class="reason" class:bad={e.status >= 300}
						>{e.reason.charAt(0).toUpperCase() + e.reason.slice(1)}
						{#if !e.signed && e.status < 300}<span class="hk-badge hk-badge--outline">Unsigned</span
							>{/if}</span
					>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.hk-secret {
		min-height: 2.75rem;
	}
	.hk-secret form {
		display: contents;
	}
	.hk-secret :global(button) {
		font-family: var(--hk-font-sans);
	}
	.dim {
		color: var(--hk-text-3);
		letter-spacing: 0.05em;
	}
	.lock {
		display: inline-flex;
		flex: none !important;
		color: var(--hk-text-3);
	}
	.secret-foot {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--hk-text-3);
	}

	section {
		margin-top: 2.75rem;
	}
	.sec-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}
	h2 {
		margin: 0;
		font-size: 1.25rem;
		line-height: 1.75rem;
		letter-spacing: -0.01em;
	}
	.caption {
		font-size: 0.8125rem;
		color: var(--hk-text-3);
	}

	.log {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 0.8125rem;
	}
	.log-head {
		display: none;
	}
	.log-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		grid-template-areas:
			'status time trigger'
			'reason reason reason'
			'delivery delivery bytes';
		align-items: center;
		gap: 0.25rem 0.75rem;
		padding: 0.75rem 0;
		border-top: 1px solid var(--hk-hairline);
	}
	.time {
		grid-area: time;
		color: var(--hk-text-2);
		white-space: nowrap;
	}
	.day {
		color: var(--hk-text);
		margin-right: 0.25rem;
	}
	.status {
		grid-area: status;
	}
	.trigger {
		grid-area: trigger;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		justify-self: end;
		min-width: 0;
	}
	.delivery {
		grid-area: delivery;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.75rem;
		color: var(--hk-text-3);
	}
	.delivery a {
		color: var(--hk-accent);
		text-decoration: none;
	}
	.delivery a:hover {
		text-decoration: underline;
	}
	.bytes {
		grid-area: bytes;
		color: var(--hk-text-3);
	}
	.num {
		text-align: right;
	}
	.reason {
		grid-area: reason;
		color: var(--hk-text-2);
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.reason.bad {
		color: var(--hk-err);
	}

	@media (min-width: 900px) {
		.log-head,
		.log-row {
			display: grid;
			grid-template-columns: 8.5rem 3.5rem 9.5rem minmax(0, 1.2fr) 4.5rem minmax(0, 1fr);
			grid-template-areas: none;
			gap: 0 1rem;
		}
		.log-head {
			padding-bottom: 0.5rem;
			border-bottom: 1px solid var(--hk-border);
			font-size: 0.75rem;
			font-weight: 500;
			color: var(--hk-text-3);
		}
		.log-head + .log-row {
			border-top: 0;
		}
		.log-row {
			padding: 0.625rem 0;
		}
		.log-row > * {
			grid-area: auto;
		}
		.trigger {
			justify-self: start;
		}
		.reason {
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.reason .hk-badge {
			margin-left: 0.25rem;
		}
	}
</style>
