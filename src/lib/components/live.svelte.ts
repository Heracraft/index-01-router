/** Connection state of the /events stream, and the recording to mark once after an upload */
export const live = $state<{ connected: boolean; flash: string | null }>({
	connected: false,
	flash: null
});
