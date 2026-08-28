/**
 * Minimal DOM helpers, built around one constraint.
 *
 * An idle game redraws numbers many times a second, forever, on phones. Setting
 * `textContent` to the value it already holds still costs a style
 * recalculation, and doing that across sixty rows is the difference between a
 * game that idles at 2% CPU and one that drains a battery. So every write here
 * is guarded by a comparison against the last value written.
 *
 * There is no framework because there is nothing for one to do: the view is a
 * fixed set of nodes built once, and updating it is assigning strings to them.
 * A diffing library would add a bundle to download and a virtual tree to walk,
 * to solve a problem this game does not have.
 */

type Attributes = Record<string, string>;
type Child = Node | string;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** Writes text only when it differs from what is already there. */
export function setText(node: HTMLElement, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

/** Sets a CSS custom property only on change; used for progress-bar widths. */
export function setVariable(node: HTMLElement, name: string, value: string): void {
  if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
}

export function setToggle(node: HTMLElement, className: string, on: boolean): void {
  if (node.classList.contains(className) !== on) node.classList.toggle(className, on);
}

export function setDisabled(node: HTMLButtonElement, disabled: boolean): void {
  if (node.disabled !== disabled) node.disabled = disabled;
}

export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}
