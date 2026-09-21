export class RefreshCoordinator {
    constructor({ readSpaces, adoptSpaces, render, isBusy = () => false, onError = () => {}, delay = 100, maxRetries = 3,
        schedule = (callback, timeout) => globalThis.setTimeout(callback, timeout),
        cancel = timer => globalThis.clearTimeout(timer) }) {
        this.readSpaces = readSpaces;
        this.adoptSpaces = adoptSpaces;
        this.render = render;
        this.isBusy = isBusy;
        this.onError = onError;
        this.delay = delay;
        this.maxRetries = maxRetries;
        this.scheduleFn = schedule;
        this.cancelFn = cancel;
        this.bookmarkGeneration = 0;
        this.handledBookmarkGeneration = 0;
        this.spacesDirty = false;
        this.running = false;
        this.timer = null;
        this.retryCount = 0;
    }

    invalidateBookmarks() {
        this.bookmarkGeneration++;
        this.retryCount = 0;
        this.schedule();
    }

    invalidateSpaces() {
        this.spacesDirty = true;
        this.retryCount = 0;
        this.schedule();
    }

    schedule(delay = this.delay) {
        if (this.timer !== null) this.cancelFn(this.timer);
        this.timer = this.scheduleFn(() => {
            this.timer = null;
            return this.drain().catch(this.onError);
        }, delay);
    }

    retry() {
        this.retryCount = 0;
        this.schedule();
    }

    async drain() {
        if (this.running) return;
        const hasBookmarkWork = this.bookmarkGeneration > this.handledBookmarkGeneration;
        if (!hasBookmarkWork && !this.spacesDirty) return;
        if (this.isBusy()) return;

        this.running = true;
        const generation = this.bookmarkGeneration;
        let failed = false;
        try {
            const next = await this.readSpaces();
            if (this.isBusy()) return;
            const adoption = await this.adoptSpaces(next);
            if (this.isBusy() || adoption?.completed === false) return;
            const metadataNeedsRender = typeof adoption === 'object' ? adoption.needsRender : adoption;
            if (metadataNeedsRender || generation > this.handledBookmarkGeneration) {
                const renderCompleted = await this.render();
                if (renderCompleted === false || this.isBusy()) return;
            }
            this.spacesDirty = false;
            this.handledBookmarkGeneration = generation;
            this.retryCount = 0;
        } catch (error) {
            failed = true;
            this.onError(error);
            if (this.retryCount < this.maxRetries) {
                const retryDelay = this.delay * (2 ** this.retryCount);
                this.retryCount++;
                this.schedule(retryDelay);
            }
        } finally {
            this.running = false;
        }

        if (!failed && (this.spacesDirty || this.bookmarkGeneration > this.handledBookmarkGeneration)) this.schedule();
    }
}
