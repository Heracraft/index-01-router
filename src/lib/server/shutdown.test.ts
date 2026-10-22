import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installShutdown } from './shutdown.ts';

function fakeProcess() {
	const proc = new EventEmitter() as EventEmitter & { exit: ReturnType<typeof vi.fn> };
	proc.exit = vi.fn();
	return proc;
}

describe('installShutdown', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	function setup() {
		const proc = fakeProcess();
		let finish = () => {};
		const deps = {
			stopAccepting: vi.fn(),
			whenIdle: vi.fn(() => new Promise<void>((r) => (finish = r))),
			closeDb: vi.fn(async () => {}),
			drainMs: 1000,
			backstopMs: 5000
		};
		installShutdown(deps, proc as unknown as NodeJS.Process);
		return { proc, deps, finish: () => finish() };
	}

	it('stops taking jobs on SIGTERM and exits 0 once jobs finish and the server closed', async () => {
		const { proc, deps, finish } = setup();
		proc.emit('SIGTERM', 'SIGTERM');
		expect(deps.stopAccepting).toHaveBeenCalledOnce();
		proc.emit('sveltekit:shutdown', 'SIGTERM');
		await vi.advanceTimersByTimeAsync(10);
		expect(deps.closeDb).not.toHaveBeenCalled();
		finish();
		await vi.advanceTimersByTimeAsync(0);
		expect(deps.closeDb).toHaveBeenCalledOnce();
		expect(proc.exit).toHaveBeenCalledWith(0);
	});

	it('gives up on running jobs after the drain time', async () => {
		const { proc, deps } = setup();
		proc.emit('SIGINT', 'SIGINT');
		proc.emit('sveltekit:shutdown', 'SIGINT');
		await vi.advanceTimersByTimeAsync(999);
		expect(proc.exit).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(deps.closeDb).toHaveBeenCalledOnce();
		expect(proc.exit).toHaveBeenCalledWith(0);
	});

	it('exits on the backstop when the server never closes', async () => {
		const { proc } = setup();
		proc.emit('SIGTERM', 'SIGTERM');
		await vi.advanceTimersByTimeAsync(5000);
		expect(proc.exit).toHaveBeenCalledWith(0);
	});

	it('exits 1 at once on a second signal', () => {
		const { proc, deps } = setup();
		proc.emit('SIGINT', 'SIGINT');
		proc.emit('SIGINT', 'SIGINT');
		expect(deps.stopAccepting).toHaveBeenCalledOnce();
		expect(proc.exit).toHaveBeenCalledWith(1);
	});
});
