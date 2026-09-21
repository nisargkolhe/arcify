export class EditSessionRegistry {
    constructor(onIdle = () => {}) {
        this.sessions = new Set();
        this.onIdle = onIdle;
    }

    begin(kind, id) {
        const session = { kind, id: String(id ?? ''), completion: null };
        this.sessions.add(session);
        return session;
    }

    isActive() {
        return this.sessions.size > 0;
    }

    complete(session, operation = async () => {}) {
        if (!session) return Promise.resolve();
        if (session.completion) return session.completion;
        session.completion = Promise.resolve().then(operation).finally(() => {
            this.sessions.delete(session);
            if (!this.sessions.size) this.onIdle();
        });
        return session.completion;
    }
}
