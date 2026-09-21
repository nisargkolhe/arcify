export class RefreshCoordinator {
    constructor({ readSpaces, adoptSpaces, render, isBusy = () => false, onError = () => {}, delay = 100, schedule = setTimeout, cancel = clearTimeout }) {
        this.readSpaces = readSpaces;
        this.adoptSpaces = adoptSpaces;
        this.render = render;
        this.isBusy = isBusy;
        this.onError = onError;
        this.delay = delay;
        this.scheduleFn = schedule;
        this.cancelFn = cancel;
        this.bookmarkGeneration = 0;
        this.handledBookmarkGeneration = 0;
        this.spacesDirty = false;
        this.running = false;
        this.timer = null;
    }

    invalidateBookmarks() {
        this.bookmarkGeneration++;
        this.schedule();
    }

    invalidateSpaces() {
        this.spacesDirty = true;
        this.schedule();
    }

    schedule() {
        if (this.timer !== null) this.cancelFn(this.timer);
        this.timer = this.scheduleFn(() => {
            this.timer = null;
            return this.drain().catch(this.onError);
        }, this.delay);
    }

    async drain() {
        if (this.running) return;
        const hasBookmarkWork = this.bookmarkGeneration > this.handledBookmarkGeneration;
        if (!hasBookmarkWork && !this.spacesDirty) return;
        if (this.isBusy()) {
            this.schedule();
            return;
        }

        this.running = true;
        const generation = this.bookmarkGeneration;
        let failed = false;
        try {
            const next = await this.readSpaces();
            const metadataNeedsRender = await this.adoptSpaces(next);
            if (metadataNeedsRender || generation > this.handledBookmarkGeneration) await this.render();
            this.spacesDirty = false;
            this.handledBookmarkGeneration = generation;
        } catch (error) {
            failed = true;
            this.onError(error);
            this.schedule();
        } finally {
            this.running = false;
        }

        if (!failed && (this.spacesDirty || this.bookmarkGeneration > this.handledBookmarkGeneration)) this.schedule();
    }
}
