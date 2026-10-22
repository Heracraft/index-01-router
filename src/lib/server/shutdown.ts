// Graceful stop for the production server (adapter-node). On SIGTERM or SIGINT the pipeline stops
// taking jobs and open event streams close at once, so adapter-node's httpServer.close() can
// finish. adapter-node then emits 'sveltekit:shutdown'; running jobs get until DRAIN_MS after the
// signal, the pool closes and the process exits 0. Jobs cut off resume on the next boot.

/** Time running jobs get after the signal. Keep under compose.yaml stop_grace_period (30s) */
export const DRAIN_MS = 20_000;
/** Exit even if 'sveltekit:shutdown' never comes (a request that will not end) */
export const BACKSTOP_MS = 27_000;

export interface ShutdownDeps {
	/** Stops starting jobs and closes event streams */
	stopAccepting: () => void;
	/** Resolves once no job runs */
	whenIdle: () => Promise<void>;
	closeDb: () => Promise<void>;
	drainMs?: number;
	backstopMs?: number;
}

type Proc = Pick<NodeJS.Process, 'on' | 'once' | 'exit'>;

const wait = (ms: number) =>
	new Promise<void>((r) => {
		setTimeout(r, ms).unref();
	});

export function installShutdown(deps: ShutdownDeps, proc: Proc = process): void {
	const { drainMs = DRAIN_MS, backstopMs = BACKSTOP_MS } = deps;
	let drained: Promise<void> | undefined;

	const onSignal = (signal: string) => {
		if (drained) {
			// A second Ctrl+C or SIGTERM: stop waiting
			console.log(`${signal} again, exiting now`);
			proc.exit(1);
			return;
		}
		console.log(`${signal}: finishing running recordings, then exiting`);
		deps.stopAccepting();
		drained = Promise.race([deps.whenIdle(), wait(drainMs)]);
		setTimeout(() => {
			console.error('Shutdown took too long, exiting');
			proc.exit(0);
		}, backstopMs).unref();
	};
	proc.on('SIGTERM', onSignal);
	proc.on('SIGINT', onSignal);

	proc.once('sveltekit:shutdown', async () => {
		try {
			await (drained ?? Promise.race([deps.whenIdle(), wait(drainMs)]));
			await deps.closeDb();
		} catch (e) {
			console.error('Shutdown cleanup failed', e);
		}
		proc.exit(0);
	});
}
