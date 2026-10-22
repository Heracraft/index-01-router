/** Connection state of the /events stream, the recording to mark once after an upload, and
 *  whether the header's search icon brought you to the search page */
export const live = $state<{ connected: boolean; flash: string | null; find: boolean }>({
	connected: false,
	flash: null,
	find: false
});
