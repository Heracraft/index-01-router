<script lang="ts">
	/* Ink switch: on reads as ink, off as zinc. A checkbox underneath, so forms post it as before */
	interface Props {
		name?: string;
		checked?: boolean;
		label: string;
		form?: string;
		id?: string;
		disabled?: boolean;
		onchange?: (e: Event & { currentTarget: HTMLInputElement }) => void;
	}
	let {
		name,
		checked = $bindable(false),
		label,
		form,
		id,
		disabled = false,
		onchange
	}: Props = $props();
</script>

<label class="switch">
	<input
		type="checkbox"
		role="switch"
		{id}
		{name}
		{form}
		{disabled}
		bind:checked
		aria-label={label}
		{onchange}
	/>
	<span aria-hidden="true"></span>
</label>
