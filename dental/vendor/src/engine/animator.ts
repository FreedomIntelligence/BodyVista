/** Tiny animation driver ticked by the engine loop (no per-frame React). */

export type Easing = (t: number) => number;
export const easeInOutCubic: Easing = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Anim {
  key: string;
  t: number;
  duration: number;
  ease: Easing;
  step: (k: number) => void;
  done?: () => void;
}

export class Animator {
  private anims = new Map<string, Anim>();
  reducedMotion = false;

  /** Start (or replace) an animation keyed by `key`. step receives eased progress 0…1. */
  run(key: string, duration: number, step: (k: number) => void, opts: { ease?: Easing; done?: () => void } = {}) {
    const d = this.reducedMotion ? 0 : duration;
    if (d <= 0) {
      step(1);
      opts.done?.();
      this.anims.delete(key);
      return;
    }
    this.anims.set(key, { key, t: 0, duration: d, ease: opts.ease ?? easeInOutCubic, step, done: opts.done });
  }

  cancel(key: string) {
    this.anims.delete(key);
  }

  isRunning(key: string): boolean {
    return this.anims.has(key);
  }

  get active(): boolean {
    return this.anims.size > 0;
  }

  tick(dt: number) {
    for (const a of [...this.anims.values()]) {
      a.t = Math.min(1, a.t + dt / a.duration);
      a.step(a.ease(a.t));
      if (a.t >= 1) {
        this.anims.delete(a.key);
        a.done?.();
      }
    }
  }
}
