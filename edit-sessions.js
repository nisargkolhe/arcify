export class EditSessionRegistry {
    constructor(onIdle = () => {}) {
        this.sessions = new Set();
        this.sessionsByOwner = new Map();
        this.onIdle = onIdle;
    }

    begin(kind, id) {
        const session = { kind, id: String(id ?? ''), completion: null, disposed: false };
        this.sessions.add(session);
        this.#addOwner(session);
        return session;
    }

    isActive() {
        return this.sessions.size > 0;
    }

    complete(session, operation = async () => {}) {
        if (!session) return Promise.resolve();
        if (session.completion) return session.completion;
        session.completion = Promise.resolve().then(() => session.disposed ? undefined : operation()).finally(() => this.#release(session));
        return session.completion;
    }

    setOwner(session, kind, id) {
        if (!session || session.disposed) return;
        this.#removeOwner(session);
        session.kind = kind;
        session.id = String(id ?? '');
        this.#addOwner(session);
    }

    dispose(kind, id) {
        const key = this.#key(kind, id);
        for (const session of [...(this.sessionsByOwner.get(key) || [])]) {
            session.disposed = true;
            this.#release(session);
        }
    }

    #key(kind, id) {
        return `${kind}:${String(id ?? '')}`;
    }

    #addOwner(session) {
        const key = this.#key(session.kind, session.id);
        if (!this.sessionsByOwner.has(key)) this.sessionsByOwner.set(key, new Set());
        this.sessionsByOwner.get(key).add(session);
    }

    #removeOwner(session) {
        const key = this.#key(session.kind, session.id);
        const owned = this.sessionsByOwner.get(key);
        owned?.delete(session);
        if (owned?.size === 0) this.sessionsByOwner.delete(key);
    }

    #release(session) {
        if (!this.sessions.delete(session)) return;
        this.#removeOwner(session);
        if (!this.sessions.size) this.onIdle();
    }
}
