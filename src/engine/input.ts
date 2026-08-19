import { clamp, type Vec2 } from './math';

/**
 * Input aggregation.
 *
 * Gameplay code should never read raw key codes: it asks for intent
 * ("is the player moving?", "was dash pressed this tick?"). That indirection
 * is what lets keyboard, mouse, touch and gamepad all drive the same actions,
 * and it keeps rebinding a data change rather than a code change.
 *
 * Edge state (`wasPressed`) is latched on the DOM event and consumed once per
 * simulation tick, so a key tapped between two ticks is never swallowed.
 */
export type Action =
  'up' | 'down' | 'left' | 'right' | 'dash' | 'fire' | 'pause' | 'confirm' | 'restart';

const DEFAULT_BINDINGS: Record<string, Action> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'dash',
  ShiftLeft: 'dash',
  KeyJ: 'fire',
  Escape: 'pause',
  KeyP: 'pause',
  Enter: 'confirm',
  KeyR: 'restart',
};

export class Input {
  private readonly held = new Set<Action>();
  private readonly pressedEdge = new Set<Action>();
  private readonly releasedEdge = new Set<Action>();
  private readonly bindings: Record<string, Action>;

  /** Pointer position in CSS pixels relative to the canvas. */
  readonly pointer: Vec2 = { x: 0, y: 0 };
  pointerDown = false;
  /** Set once any touch is seen, so the UI can switch to on-screen controls. */
  touchDetected = false;

  /** Analog move vector from a virtual stick; overrides keys when non-zero. */
  private readonly stick: Vec2 = { x: 0, y: 0 };

  private readonly listeners: (() => void)[] = [];

  constructor(
    private readonly target: HTMLCanvasElement,
    bindings: Record<string, Action> = DEFAULT_BINDINGS,
  ) {
    this.bindings = bindings;
    this.attach();
  }

  private on<K extends keyof WindowEventMap>(
    element: Window | HTMLElement,
    type: K,
    handler: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    const listener = handler as EventListener;
    element.addEventListener(type, listener, options);
    this.listeners.push(() => element.removeEventListener(type, listener));
  }

  private attach(): void {
    this.on(window, 'keydown', (event) => {
      const action = this.bindings[event.code];
      if (action === undefined) return;
      // Stop the browser scrolling the page out from under the canvas.
      event.preventDefault();
      if (event.repeat) return;
      this.held.add(action);
      this.pressedEdge.add(action);
    });

    this.on(window, 'keyup', (event) => {
      const action = this.bindings[event.code];
      if (action === undefined) return;
      this.held.delete(action);
      this.releasedEdge.add(action);
    });

    // A window that loses focus mid-input would otherwise keep the key "held".
    this.on(window, 'blur', () => this.releaseAll());

    this.on(this.target, 'pointermove', (event) => this.updatePointer(event));
    this.on(this.target, 'pointerdown', (event) => {
      if (event.pointerType === 'touch') this.touchDetected = true;
      this.updatePointer(event);
      this.pointerDown = true;
      this.held.add('fire');
      this.pressedEdge.add('fire');
      this.target.setPointerCapture(event.pointerId);
    });
    this.on(window, 'pointerup', () => {
      this.pointerDown = false;
      this.held.delete('fire');
      this.releasedEdge.add('fire');
    });
    this.on(this.target, 'contextmenu', (event) => event.preventDefault());
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.target.getBoundingClientRect();
    this.pointer.x = event.clientX - rect.left;
    this.pointer.y = event.clientY - rect.top;
  }

  /** Feeds an analog direction from the on-screen stick. Components in [-1, 1]. */
  setStick(x: number, y: number): void {
    this.stick.x = clamp(x, -1, 1);
    this.stick.y = clamp(y, -1, 1);
  }

  isHeld(action: Action): boolean {
    return this.held.has(action);
  }

  /** True only on the tick the action went down. */
  wasPressed(action: Action): boolean {
    return this.pressedEdge.has(action);
  }

  wasReleased(action: Action): boolean {
    return this.releasedEdge.has(action);
  }

  /** Fires an action from UI code (on-screen buttons) as if it were a key. */
  press(action: Action): void {
    this.held.add(action);
    this.pressedEdge.add(action);
  }

  release(action: Action): void {
    this.held.delete(action);
    this.releasedEdge.add(action);
  }

  /**
   * Desired movement direction, magnitude capped at 1 so that holding two
   * keys diagonally is not 41% faster than holding one.
   */
  moveVector(out: Vec2): Vec2 {
    if (this.stick.x !== 0 || this.stick.y !== 0) {
      out.x = this.stick.x;
      out.y = this.stick.y;
    } else {
      out.x = (this.isHeld('right') ? 1 : 0) - (this.isHeld('left') ? 1 : 0);
      out.y = (this.isHeld('down') ? 1 : 0) - (this.isHeld('up') ? 1 : 0);
    }
    const len = Math.hypot(out.x, out.y);
    if (len > 1) {
      out.x /= len;
      out.y /= len;
    }
    return out;
  }

  /** Called at the end of every simulation tick, after systems have read input. */
  endTick(): void {
    this.pressedEdge.clear();
    this.releasedEdge.clear();
  }

  private releaseAll(): void {
    this.held.clear();
    this.pointerDown = false;
    this.stick.x = 0;
    this.stick.y = 0;
  }

  destroy(): void {
    for (const off of this.listeners) off();
    this.listeners.length = 0;
    this.releaseAll();
  }
}
