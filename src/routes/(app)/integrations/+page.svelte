<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import PageHead from '#lib/components/PageHead.svelte';
	import { formatDateTime, triggerLabel } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const tz = $derived(data.timezone);
	const triggers = (list: string[]) =>
		list.length ? list.map(triggerLabel).join(', ') : 'All triggers';
	const STATUS: Record<string, string> = {
		sent: 'Sent',
		failed: 'Failed',
		pending: 'Pending',
		skipped: 'Skipped'
	};
</script>

<PageHead title="Integrations">
	{#snippet actions()}
		{#each data.kinds as k (k.kind)}
			<a class="hk-btn" href="{resolve('/(app)/integrations/[id]', { id: 'new' })}?kind={k.kind}"
				>Add {k.label}</a
			>
		{/each}
	{/snippet}
</PageHead>

{#if form?.error}
	<p class="hk-banner hk-banner--err" role="alert">{form.error}</p>
{/if}

{#if data.integrations.length === 0}
	<div class="hk-empty-row">
		<span>No integrations yet.</span>
	</div>
{:else}
	<div class="tbl" role="region" aria-label="Integrations" tabindex="-1">
		<table class="hk-table">
			<thead>
				<tr>
					<th>Name</th>
					<th>Kind</th>
					<th>Triggers</th>
					<th>Last delivery</th>
					<th>Enabled</th>
				</tr>
			</thead>
			<tbody>
				{#each data.integrations as i (i.id)}
					<tr class:off={!i.enabled}>
						<td class="name-cell">
							<a class="name" href={resolve('/(app)/integrations/[id]', { id: i.id })}>{i.name}</a>
							<span class="meta">{i.kindLabel} · {triggers(i.triggers)}</span>
						</td>
						<td class="wide">{i.kindLabel}</td>
						<td class="wide">{triggers(i.triggers)}</td>
						<td class="last">
							{#if i.last}
								<a
									class="last-link"
									href={resolve('/(app)/recordings/[id]', { id: i.last.recordingId })}
								>
									{#if i.last.status === 'failed'}
										<span class="hk-badge hk-badge--err">Failed</span>
									{:else}
										<span>{STATUS[i.last.status] ?? i.last.status}</span>
									{/if}
									<span class="when hk-num">{formatDateTime(i.last.at, tz)}</span>
								</a>
							{:else}
								<span class="when">None yet</span>
							{/if}
						</td>
						<td>
							<form method="POST" action="?/enabled" use:enhance>
								<input type="hidden" name="id" value={i.id} />
								<label class="hk-check">
									<input
										type="checkbox"
										name="enabled"
										checked={i.enabled}
										onchange={(e) => e.currentTarget.form?.requestSubmit()}
									/>
									<span class="hk-sr">Enabled</span>
									<span aria-hidden="true">{i.enabled ? 'On' : 'Off'}</span>
								</label>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.tbl {
		overflow-x: auto;
	}
	.name {
		color: var(--hk-text);
		font-weight: 500;
		text-decoration: none;
		font-size: 0.875rem;
	}
	.name:hover {
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, currentColor 35%, transparent);
	}
	.meta {
		display: none;
		font-size: 0.8125rem;
		color: var(--hk-text-3);
	}
	tr.off .name {
		color: var(--hk-text-3);
	}
	.last-link {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--hk-text);
		text-decoration: none;
	}
	.last-link:hover .when {
		color: var(--hk-text);
	}
	.when {
		color: var(--hk-text-3);
	}
	.hk-check {
		font-size: 0.8125rem;
	}
	.hk-table td {
		padding-block: 0.875rem;
	}

	@media (max-width: 639.98px) {
		thead,
		.hk-table td.wide {
			display: none;
		}
		.meta {
			display: block;
		}
		.hk-table tr {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas: 'name toggle' 'last last';
			gap: 0.25rem 1rem;
			padding: 0.875rem 0;
			border-top: 1px solid var(--hk-hairline);
		}
		.hk-table td {
			display: block;
			padding: 0 !important;
			border: 0;
		}
		.name-cell {
			grid-area: name;
		}
		.last {
			grid-area: last;
			font-size: 0.8125rem;
		}
		.hk-table td:last-child {
			grid-area: toggle;
		}
	}
</style>
