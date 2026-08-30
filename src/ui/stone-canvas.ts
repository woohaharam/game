/**
 * The stone, drawn rather than downloaded.
 *
 * The whole point of a growing game is watching the thing change, and an emoji
 * swap is not a change — it is a different character in the same slot. This
 * draws the stone from the form's traits: an irregular lump early on, rounding
 * out as it gains mass, gathering craters, then continents, then an atmosphere,
 * rings, a corona, and finally arms.
 *
 * Procedural for the same reason nothing else here is an asset. Twenty
 * hand-drawn sprites would be most of a bundle that a portal player downloads
 * before anything is playable, and they could not scale to a phone's pixel
 * ratio. This costs a few hundred lines and nothing at all to ship.
 *
 * Two properties matter more than the drawing itself. The shape is *stable* —
 * seeded from the form, so the same stage always produces the same silhouette
 * and craters, and the thing the player is growing never appears to writhe. And
 * the rotation is *slow*: it is there so the stone reads as an object rather
 * than a sticker, not so it performs.
 */

import { between, mulberry32, type Random } from '@core/rng';
import { appearanceForForm, type FormAppearance } from '@game/content/appearance';
import { FORM_COUNT, formIndex, formProgress } from '@game/content/stages';

/** Points around the silhouette. Enough to read as irregular, few enough to be cheap. */
const SILHOUETTE_POINTS = 24;

/** Radians per second. A full turn takes about a minute and a half. */
const SPIN_RATE = 0.07;

/** The body never fills the canvas: glow, rings and atmosphere need the margin. */
const BODY_RADIUS_FRACTION = 0.32;

/** Within one form, the stone grows this much before the shape changes. */
const GROWTH_WITHIN_FORM = 0.14;

interface Crater {
  readonly angle: number;
  readonly distance: number;
  readonly radius: number;
  readonly depth: number;
}

interface Patch {
  readonly angle: number;
  readonly distance: number;
  readonly radius: number;
  readonly colour: string;
}

/** Everything about a form's look that is fixed once generated. */
interface Silhouette {
  readonly radii: readonly number[];
  readonly craters: readonly Crater[];
  readonly patches: readonly Patch[];
}

function buildSilhouette(random: Random, appearance: FormAppearance): Silhouette {
  const radii: number[] = [];
  for (let i = 0; i < SILHOUETTE_POINTS; i += 1) {
    // Two frequencies rather than pure noise: a slow wobble gives the overall
    // lopsidedness and a fast one gives the facets, which is what makes a rock
    // read as a rock instead of a blob.
    const slow = Math.sin((i / SILHOUETTE_POINTS) * Math.PI * 2 * 1.5 + random() * 0.001);
    radii.push(1 + appearance.roughness * (slow * 0.12 + between(random, -0.16, 0.16)));
  }

  const craters: Crater[] = [];
  for (let i = 0; i < appearance.craters; i += 1) {
    craters.push({
      angle: between(random, 0, Math.PI * 2),
      // Biased inwards: a crater drawn at the very edge is a bite, not a dent.
      distance: Math.sqrt(random()) * 0.72,
      radius: between(random, 0.08, 0.2),
      depth: between(random, 0.25, 0.6),
    });
  }

  const patches: Patch[] = [];
  for (const colour of appearance.patches) {
    const count = 2 + Math.floor(random() * 3);
    for (let i = 0; i < count; i += 1) {
      patches.push({
        angle: between(random, 0, Math.PI * 2),
        distance: Math.sqrt(random()) * 0.66,
        radius: between(random, 0.16, 0.4),
        colour,
      });
    }
  }

  return { radii, craters, patches };
}

export class StoneRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private silhouette: Silhouette | null = null;
  private silhouetteForm = -1;
  private size = 0;

  constructor(private readonly reducedMotion: boolean) {}

  mount(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.className = 'stone-canvas';
    // Decorative: the form name and the mass beside it already say everything
    // this conveys, so announcing it again would only be noise.
    canvas.setAttribute('aria-hidden', 'true');
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    return canvas;
  }

  /**
   * Matches the backing store to the element's rendered size and the device's
   * pixel ratio, and reports whether there is anything to draw on.
   *
   * Done every frame because a canvas sized once is blurry the moment the
   * window changes, and cheap because the assignment is skipped when nothing
   * moved — setting `width` at all clears the canvas and resets the context.
   */
  private resize(): boolean {
    const canvas = this.canvas;
    const context = this.context;
    if (canvas === null || context === null) return false;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return false;

    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    const pixels = Math.round(rect.width * ratio);
    if (canvas.width !== pixels || canvas.height !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
    }

    this.size = pixels;
    return true;
  }

  draw(stage: number, now: number): void {
    if (!this.resize()) return;
    const context = this.context;
    if (context === null) return;

    const index = formIndex(stage);
    const appearance = appearanceForForm(index % FORM_COUNT);

    if (this.silhouette === null || this.silhouetteForm !== index) {
      // Seeded from the form, not the stage, so the stone keeps its identity
      // while it grows and only changes when it becomes something else.
      this.silhouette = buildSilhouette(mulberry32(index * 2654435761), appearance);
      this.silhouetteForm = index;
    }

    const size = this.size;
    const centre = size / 2;
    const spin = this.reducedMotion ? 0 : (now / 1000) * SPIN_RATE;
    const radius = size * BODY_RADIUS_FRACTION * (1 + formProgress(stage) * GROWTH_WITHIN_FORM);

    context.clearRect(0, 0, size, size);

    if (appearance.glow !== null) this.drawGlow(context, centre, radius, appearance.glow);

    // A galaxy is not a rounder rock, it is a different kind of thing: no
    // silhouette, no lit side, nothing to put craters on. Drawing a body over
    // the arms hides the only part worth seeing.
    if (appearance.spiral) {
      this.drawGalaxy(context, centre, radius, spin, appearance);
      return;
    }

    context.save();
    context.translate(centre, centre);
    context.rotate(spin);

    if (appearance.rings) this.drawRings(context, radius, appearance, false);
    this.drawBody(context, radius, appearance, this.silhouette);
    if (appearance.rings) this.drawRings(context, radius, appearance, true);

    context.restore();
  }

  private bodyPath(
    context: CanvasRenderingContext2D,
    radius: number,
    radii: readonly number[],
  ): void {
    context.beginPath();
    for (let i = 0; i < radii.length; i += 1) {
      const angle = (i / radii.length) * Math.PI * 2;
      const r = radius * (radii[i] ?? 1);
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
  }

  private drawBody(
    context: CanvasRenderingContext2D,
    radius: number,
    appearance: FormAppearance,
    silhouette: Silhouette,
  ): void {
    this.bodyPath(context, radius, silhouette.radii);

    // One light source, upper left, for every form. Consistency is what stops a
    // ladder of twenty bodies looking like twenty unrelated drawings.
    const lit = context.createRadialGradient(
      -radius * 0.35,
      -radius * 0.4,
      radius * 0.05,
      0,
      0,
      radius * 1.15,
    );
    lit.addColorStop(0, appearance.highlight);
    lit.addColorStop(0.55, appearance.core);
    lit.addColorStop(1, appearance.shadow);
    context.fillStyle = lit;
    context.fill();

    context.save();
    context.clip();

    for (const patch of silhouette.patches) {
      context.beginPath();
      context.ellipse(
        Math.cos(patch.angle) * patch.distance * radius,
        Math.sin(patch.angle) * patch.distance * radius,
        patch.radius * radius,
        patch.radius * radius * 0.7,
        patch.angle,
        0,
        Math.PI * 2,
      );
      context.globalAlpha = 0.55;
      context.fillStyle = patch.colour;
      context.fill();
    }
    context.globalAlpha = 1;

    for (const crater of silhouette.craters) {
      const x = Math.cos(crater.angle) * crater.distance * radius;
      const y = Math.sin(crater.angle) * crater.distance * radius;
      const r = crater.radius * radius;

      // A dark disc offset against a light one: the cheapest thing that reads
      // as a depression rather than a spot.
      context.beginPath();
      context.arc(x + r * 0.12, y + r * 0.12, r, 0, Math.PI * 2);
      context.fillStyle = appearance.highlight;
      context.globalAlpha = crater.depth * 0.35;
      context.fill();

      context.beginPath();
      context.arc(x - r * 0.08, y - r * 0.08, r * 0.92, 0, Math.PI * 2);
      context.fillStyle = appearance.shadow;
      context.globalAlpha = crater.depth * 0.5;
      context.fill();
    }
    context.globalAlpha = 1;
    context.restore();

    if (appearance.atmosphere > 0) {
      // Drawn as a stroke just inside the edge rather than a halo outside it,
      // which is what an atmosphere seen edge-on actually looks like.
      this.bodyPath(context, radius, silhouette.radii);
      context.strokeStyle = appearance.highlight;
      context.globalAlpha = appearance.atmosphere * 0.55;
      context.lineWidth = Math.max(1, radius * 0.07);
      context.stroke();
      context.globalAlpha = 1;
    }
  }

  private drawGlow(
    context: CanvasRenderingContext2D,
    centre: number,
    radius: number,
    colour: string,
  ): void {
    const glow = context.createRadialGradient(
      centre,
      centre,
      radius * 0.7,
      centre,
      centre,
      radius * 2.4,
    );
    glow.addColorStop(0, colour);
    glow.addColorStop(1, 'rgb(0 0 0 / 0%)');
    context.fillStyle = glow;
    context.fillRect(0, 0, centre * 2, centre * 2);
  }

  private drawRings(
    context: CanvasRenderingContext2D,
    radius: number,
    appearance: FormAppearance,
    inFront: boolean,
  ): void {
    // Split into a back half and a front half around the body, which is the
    // only thing that makes rings read as passing *behind* the planet.
    const start = inFront ? 0 : Math.PI;
    context.save();
    context.rotate(-0.42);
    for (const [index, scale] of [1.5, 1.72, 1.92].entries()) {
      context.beginPath();
      context.ellipse(0, 0, radius * scale, radius * scale * 0.28, 0, start, start + Math.PI);
      context.strokeStyle = index % 2 === 0 ? appearance.highlight : appearance.core;
      context.globalAlpha = inFront ? 0.75 : 0.4;
      context.lineWidth = Math.max(1, radius * 0.07);
      context.stroke();
    }
    context.globalAlpha = 1;
    context.restore();
  }

  private drawGalaxy(
    context: CanvasRenderingContext2D,
    centre: number,
    radius: number,
    spin: number,
    appearance: FormAppearance,
  ): void {
    context.save();
    context.translate(centre, centre);
    context.rotate(spin * 0.5);
    // Tilted and squashed, because a galaxy seen exactly face-on reads as a
    // flat decal rather than as something with a plane.
    context.rotate(-0.3);
    context.scale(1, 0.55);

    context.lineCap = 'round';
    for (let arm = 0; arm < 3; arm += 1) {
      const offset = (arm / 3) * Math.PI * 2;

      // Each arm is drawn as a run of fading segments rather than one stroke,
      // so it thins and dims outwards the way an arm actually does.
      for (let step = 0; step < 60; step += 1) {
        const from = step / 60;
        const to = (step + 1) / 60;
        const angleFrom = offset + from * Math.PI * 2.3;
        const angleTo = offset + to * Math.PI * 2.3;
        const rFrom = radius * (0.25 + from * 1.9);
        const rTo = radius * (0.25 + to * 1.9);

        context.beginPath();
        context.moveTo(Math.cos(angleFrom) * rFrom, Math.sin(angleFrom) * rFrom);
        context.lineTo(Math.cos(angleTo) * rTo, Math.sin(angleTo) * rTo);
        context.strokeStyle = appearance.highlight;
        context.globalAlpha = 0.5 * (1 - from) ** 1.6;
        context.lineWidth = Math.max(1, radius * 0.3 * (1 - from));
        context.stroke();
      }
    }

    context.globalAlpha = 1;
    context.restore();

    // The core last and unsquashed: it is the brightest thing on the screen at
    // the top of the ladder, and it should look like it.
    const core = context.createRadialGradient(centre, centre, 0, centre, centre, radius * 0.85);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.35, appearance.highlight);
    core.addColorStop(1, 'rgb(0 0 0 / 0%)');
    context.fillStyle = core;
    context.beginPath();
    context.arc(centre, centre, radius * 0.85, 0, Math.PI * 2);
    context.fill();
  }
}
