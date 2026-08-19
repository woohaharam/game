/**
 * Minimal finite state machine used by every enemy archetype.
 *
 * Enemy behaviour written as nested `if`s becomes unreadable the moment an
 * enemy has more than two moods. An explicit FSM makes each behaviour a named
 * state with its own enter/update, makes transitions greppable, and gives the
 * debug overlay something meaningful to print.
 *
 * `timeInState` is tracked centrally because nearly every behaviour needs it
 * (wind-up length, burst duration, recovery), and hand-rolling a timer per
 * state is where desync bugs come from.
 */
export interface State<C> {
  readonly name: string;
  enter?(context: C): void;
  /** Returns the next state name, or `null`/undefined to stay put. */
  update(context: C, step: number, timeInState: number): string | null | undefined;
  exit?(context: C): void;
}

export class StateMachine<C> {
  private states = new Map<string, State<C>>();
  private active: State<C> | null = null;
  private elapsed = 0;

  constructor(states: ReadonlyArray<State<C>>, initial: string) {
    for (const state of states) this.states.set(state.name, state);
    const first = this.states.get(initial);
    if (first === undefined) throw new Error(`Unknown initial state: ${initial}`);
    this.active = first;
  }

  get current(): string {
    return this.active?.name ?? '';
  }

  get timeInState(): number {
    return this.elapsed;
  }

  /** Forces a transition; ignored when already in that state. */
  transition(name: string, context: C): void {
    if (this.active?.name === name) return;
    const next = this.states.get(name);
    if (next === undefined) throw new Error(`Unknown state: ${name}`);
    this.active?.exit?.(context);
    this.active = next;
    this.elapsed = 0;
    next.enter?.(context);
  }

  update(context: C, step: number): void {
    if (this.active === null) return;
    this.elapsed += step;
    const next = this.active.update(context, step, this.elapsed);
    if (typeof next === 'string') this.transition(next, context);
  }
}
