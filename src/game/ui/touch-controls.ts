import type { Input } from '@engine/input';
import type { Renderer } from '@engine/renderer';
import { clamp, vec2, type Vec2 } from '@engine/math';

/**
 * On-screen twin-stick controls for touch devices.
 *
 * A portfolio piece that only works on a desktop with a mouse cuts its
 * audience in half — most people open a link on a phone. So the same intents
 * the keyboard produces are also produced here: a left stick for movement, a
 * right stick that both aims and fires.
 *
 * The sticks are *floating*: each one anchors wherever the thumb first lands
 * inside its half of the screen, rather than at a fixed spot. Fixed sticks
 * mean constantly hunting for a control you cannot see under your own thumb.
 *
 * Everything is inert until a touch is actually seen, so a desktop player
 * never has thumbsticks drawn over their game.
 */
interface Stick {
  id: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
  active: boolean;
}

const STICK_RADIUS = 62;
const DEAD_ZONE = 0.14;

export class TouchControls {
  private readonly moveStick: Stick = {
    id: -1,
    originX: 0,
    originY: 0,
    x: 0,
    y: 0,
    active: false,
  };
  private readonly aimStick: Stick = {
    id: -1,
    originX: 0,
    originY: 0,
    x: 0,
    y: 0,
    active: false,
  };

  /** Pointer id currently held down on the dash button, or -1. */
  private dashPointer = -1;
  private canvas: HTMLCanvasElement | null = null;
  private renderer: Renderer | null = null;
  private enabled = false;

  /** World-space aim point produced by the right stick, when engaged. */
  aimOverride: Vec2 | null = null;
  firing = false;

  private readonly aimPoint: Vec2 = vec2();
  private readonly scratch: Vec2 = vec2();
  private readonly listeners: (() => void)[] = [];

  attach(input: Input, renderer: Renderer): void {
    this.renderer = renderer;
    this.canvas = renderer.canvas;

    const onDown = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch') return;
      this.enabled = true;
      const point = this.toVirtual(event);

      // The dash button sits inside the aim stick's half of the screen, so it
      // has to claim the touch before a stick anchors under it.
      if (this.isDashButton(renderer, point.x, point.y)) {
        input.press('dash');
        this.dashPointer = event.pointerId;
        return;
      }

      const stick = point.x < renderer.width / 2 ? this.moveStick : this.aimStick;
      if (stick.active) return;
      stick.id = event.pointerId;
      stick.originX = stick.x = point.x;
      stick.originY = stick.y = point.y;
      stick.active = true;
    };

    const onMove = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch') return;
      const point = this.toVirtual(event);
      for (const stick of [this.moveStick, this.aimStick]) {
        if (!stick.active || stick.id !== event.pointerId) continue;
        stick.x = point.x;
        stick.y = point.y;
      }
    };

    const onUp = (event: PointerEvent): void => {
      if (this.dashPointer === event.pointerId) {
        input.release('dash');
        this.dashPointer = -1;
      }
      for (const stick of [this.moveStick, this.aimStick]) {
        if (stick.id !== event.pointerId) continue;
        stick.active = false;
        stick.id = -1;
      }
    };

    const canvas = renderer.canvas;
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    this.listeners.push(
      () => canvas.removeEventListener('pointerdown', onDown),
      () => canvas.removeEventListener('pointermove', onMove),
      () => window.removeEventListener('pointerup', onUp),
      () => window.removeEventListener('pointercancel', onUp),
    );
  }

  detach(): void {
    for (const off of this.listeners) off();
    this.listeners.length = 0;
    this.canvas = null;
    this.renderer = null;
  }

  private toVirtual(event: PointerEvent): Vec2 {
    const renderer = this.renderer;
    const canvas = this.canvas;
    if (renderer === null || canvas === null) return this.scratch;
    const rect = canvas.getBoundingClientRect();
    this.scratch.x = event.clientX - rect.left;
    this.scratch.y = event.clientY - rect.top;
    return renderer.pointerToVirtual(this.scratch, this.scratch);
  }

  /** Folds stick state into the shared `Input`, then derives aim and fire. */
  update(input: Input, renderer: Renderer): void {
    if (!this.enabled) {
      this.aimOverride = null;
      this.firing = false;
      return;
    }

    if (this.moveStick.active) {
      const dx = (this.moveStick.x - this.moveStick.originX) / STICK_RADIUS;
      const dy = (this.moveStick.y - this.moveStick.originY) / STICK_RADIUS;
      const magnitude = Math.hypot(dx, dy);
      if (magnitude < DEAD_ZONE) input.setStick(0, 0);
      else {
        const scale = Math.min(1, magnitude) / magnitude;
        input.setStick(dx * scale, dy * scale);
      }
    } else {
      input.setStick(0, 0);
    }

    if (this.aimStick.active) {
      const dx = this.aimStick.x - this.aimStick.originX;
      const dy = this.aimStick.y - this.aimStick.originY;
      const magnitude = Math.hypot(dx, dy) / STICK_RADIUS;
      if (magnitude > DEAD_ZONE) {
        // Aim is a direction, projected far ahead of the player so the world
        // gets the same "point at a spot" intent the mouse produces.
        const angle = Math.atan2(dy, dx);
        const camera = renderer.camera;
        const centreX = camera.position.x;
        const centreY = camera.position.y;
        this.aimPoint.x = centreX + Math.cos(angle) * 400;
        this.aimPoint.y = centreY + Math.sin(angle) * 400;
        this.aimOverride = this.aimPoint;
        this.firing = true;
        return;
      }
    }
    this.aimOverride = null;
    this.firing = false;
  }

  render(renderer: Renderer, input: Input): void {
    if (!this.enabled && !input.touchDetected) return;

    for (const stick of [this.moveStick, this.aimStick]) {
      if (!stick.active) continue;
      const dx = stick.x - stick.originX;
      const dy = stick.y - stick.originY;
      const distance = Math.hypot(dx, dy);
      const clamped = clamp(distance, 0, STICK_RADIUS);
      const angle = Math.atan2(dy, dx);

      renderer.ring(stick.originX, stick.originY, STICK_RADIUS, 'rgba(110, 242, 255, 0.28)', 2);
      renderer.circle(
        stick.originX + Math.cos(angle) * clamped,
        stick.originY + Math.sin(angle) * clamped,
        20,
        'rgba(110, 242, 255, 0.42)',
      );
    }

    // A dash button, because a two-thumb layout has nowhere left for a gesture.
    if (this.enabled) {
      const x = renderer.width - 74;
      const y = renderer.height - 74;
      renderer.ring(x, y, 34, 'rgba(110, 242, 255, 0.35)', 2);
      renderer.text('DASH', x, y + 5, {
        size: 12,
        color: 'rgba(232, 244, 255, 0.75)',
        align: 'center',
        letterSpacing: '1px',
      });
    }
  }

  /** Screen-space hit test for the touch dash button. */
  isDashButton(renderer: Renderer, x: number, y: number): boolean {
    return Math.hypot(x - (renderer.width - 74), y - (renderer.height - 74)) < 40;
  }
}
