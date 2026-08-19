/** Re-exports so engine tests import one module instead of five. */
export { angleDelta, clamp, clampLength, damp, lerp, normalize } from '@engine/math';
export { explosionFalloff as explosionSafe } from '@game/combat/damage';
