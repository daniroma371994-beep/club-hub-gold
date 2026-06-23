import type { VoiceIntent } from "@/lib/voice.functions";

export type VoiceHandlers = {
  findMember: (query: string) => Promise<boolean>;
  addToCart: (productQuery: string, quantity: number, unit: "g" | "pz") => Promise<boolean>;
  removeFromCart: (productQuery: string) => Promise<boolean>;
  clearCart: () => void;
  confirmOrder: () => Promise<boolean>;
  renewPlan: (planQuery: string) => Promise<boolean>;
};

type Listener = (msg: { kind: "info" | "success" | "error"; text: string }) => void;

class VoiceBus {
  handlers: Partial<VoiceHandlers> = {};
  pending: VoiceIntent | null = null;
  private listeners = new Set<Listener>();

  register(h: Partial<VoiceHandlers>) {
    this.handlers = { ...this.handlers, ...h };
    // If an intent was queued during navigation, replay it on next tick.
    if (this.pending) {
      const intent = this.pending;
      this.pending = null;
      setTimeout(() => this.tryReplay(intent), 50);
    }
  }
  unregister(keys: (keyof VoiceHandlers)[]) {
    for (const k of keys) delete this.handlers[k];
  }
  onFeedback(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  feedback(kind: "info" | "success" | "error", text: string) {
    this.listeners.forEach((l) => l({ kind, text }));
  }
  private replayer: ((i: VoiceIntent) => void) | null = null;
  setReplayer(fn: ((i: VoiceIntent) => void) | null) {
    this.replayer = fn;
  }
  tryReplay(i: VoiceIntent) {
    if (this.replayer) this.replayer(i);
  }
}

export const voiceBus = new VoiceBus();
