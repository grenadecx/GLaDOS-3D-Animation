/**
 * define.ts — register a custom element at most once.
 *
 * The card reaches the browser by more than one route: the Lovelace resource on
 * dashboards, and the overlay module on every other page. The browser keys
 * modules by URL, so the same file fetched under two URLs — a versioned one and
 * a bare one, say — is two module instances, each running its registration.
 * A bare customElements.define throws on the second, and because that happens at
 * module scope it takes the whole card down rather than just the duplicate.
 */
export function define(tag: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
}
