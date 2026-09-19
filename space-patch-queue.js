// Panels may optimistically queue patches, but a rejected patch invalidates all
// dependent patches. Reload authoritative state instead of sending a false base.
export class SpacePatchQueue {
    constructor(send, recover) {
        this.send = send;
        this.recover = recover;
        this.chain = Promise.resolve();
        this.epoch = 0;
        this.reset([]);
    }
    reset(spaces) {
        this.blocked = false;
        this.acknowledged = structuredClone(spaces);
        this.optimistic = structuredClone(spaces);
    }
    submit(spaces) {
        if (this.blocked) return Promise.reject(new Error('Saved state is unavailable; reload before retrying.'));
        const before = structuredClone(this.optimistic);
        const after = structuredClone(spaces);
        const epoch = this.epoch;
        this.optimistic = after;
        const run = this.chain.then(async () => {
            if (epoch !== this.epoch) throw new Error('Save cancelled after an earlier failure; please retry.');
            try {
                const saved = await this.send(before, after);
                this.acknowledged = structuredClone(saved);
                return saved;
            } catch (error) {
                // Invalidate even submissions made while recovery is awaiting I/O.
                this.epoch++;
                this.blocked = true;
                try { this.reset(await this.recover(error)); }
                finally { this.epoch++; }
                throw error;
            }
        });
        this.chain = run.catch(() => {});
        return run;
    }
}
