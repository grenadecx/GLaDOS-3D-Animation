/**
 * overlay.ts — mounts the card as a full-screen layer driven by a Voice
 * Satellite assist_satellite entity.
 *
 * Voice Satellite's own overlay only supports a fixed set of skins with no slot
 * for a custom element, so rather than injecting into it we stack our own
 * transparent layer on top and show it for the same states.
 *
 * The integration loads this on every page via frontend.add_extra_js_url, and
 * hands it one config per satellite over a websocket command. Which config this
 * browser uses depends on the satellite Voice Satellite has bound it to, so two
 * screens sharing one HA can frame her differently.
 */

import { HomeAssistant } from 'custom-card-helpers';
import { Glados3DConfig } from './types.js';

const CARD_TAG = 'glados-3d-card';
const CONFIG_COMMAND = 'glados_3d/config';
/** Fired by the integration when a config entry's options change, so an edit in
 *  the UI lands on the screen without a reload. */
const CONFIG_EVENT = 'glados_3d_config_updated';
/** Let Lovelace define the card before we consider fetching our own copy. */
const CARD_WAIT_MS = 4000;
const POLL_MS = 1000;

/** One satellite's overlay settings, as sent by the integration. */
interface SatelliteConfig {
  entity: string;
  show_states: string[];
  vertical_align: string;
  only_on_bound_device: boolean;
  pass_through_taps: boolean;
  fade_ms: number;
  z_index: number;
  card: Glados3DConfig;
}

interface CardElement extends HTMLElement {
  setConfig(config: Glados3DConfig): void;
  hass: HomeAssistant | undefined;
}

/** The <home-assistant> root element carries the live hass object. */
interface HaRoot extends HTMLElement {
  hass?: HomeAssistant;
}

declare global {
  interface Window {
    __glados3dOverlay?: boolean;
  }
}

const log = (...args: unknown[]) => console.debug('[glados-3d-overlay]', ...args);

function waitFor<T>(fn: () => T | null | undefined, timeout = 60000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      let value: T | null | undefined;
      try {
        value = fn();
      } catch {
        value = null;
      }
      if (value) return resolve(value);
      if (Date.now() - started > timeout) return reject(new Error('timeout'));
      setTimeout(tick, 200);
    };
    tick();
  });
}

/**
 * Which satellite *this browser* is. Voice Satellite records it in localStorage,
 * preferring vs-satellite-entity and falling back to the panel config blob.
 */
function boundSatellite(): string | null {
  try {
    const direct = localStorage.getItem('vs-satellite-entity');
    if (direct) return direct;
    const panel = localStorage.getItem('vs-panel-config');
    if (panel) return (JSON.parse(panel) as { satellite_entity?: string }).satellite_entity ?? null;
  } catch {
    /* private mode, or storage blocked */
  }
  return null;
}

async function ensureCardDefined(): Promise<void> {
  if (customElements.get(CARD_TAG)) return;

  // On a dashboard the Lovelace resource is already pulling the card in, so wait
  // for that rather than fetching a second copy of a 600 kB bundle.
  const appeared = await Promise.race([
    customElements.whenDefined(CARD_TAG).then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CARD_WAIT_MS)),
  ]);
  if (appeared) return;

  // Resolved against this module's own URL, so it follows the integration
  // wherever it serves from and needs no hardcoded path or version. If Lovelace
  // does turn out to have loaded it too, define() makes the duplicate a no-op.
  const url = new URL('./glados-3d-card.js', import.meta.url).href;
  log('card not loaded by Lovelace, fetching', url);
  await import(url);
}

async function main(): Promise<void> {
  if (window.__glados3dOverlay) return;
  window.__glados3dOverlay = true;

  await ensureCardDefined();
  await customElements.whenDefined(CARD_TAG);

  const ha = await waitFor(() => document.querySelector<HaRoot>('home-assistant'));
  // Wait for the websocket, not just hass: ha.hass appears before its connection
  // is populated, and touching connection too early throws, which would abort
  // setup and leave the layer permanently hidden.
  const hass = await waitFor(() => (ha.hass?.connection ? ha.hass : null));

  const layer = document.createElement('div');
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    // display flips to flex only while shown -- see setShown.
    display: 'none',
    justifyContent: 'center',
    // Pinned to the top she would otherwise render under the status bar and the
    // camera cutout; on anything without a notch this resolves to zero.
    paddingTop: 'env(safe-area-inset-top, 0px)',
    boxSizing: 'border-box',
    // No backdrop: Voice Satellite already dims the page, and a second scrim
    // just made its transcript hard to read.
    background: 'none',
  });

  const card = document.createElement(CARD_TAG) as CardElement;
  card.style.maxWidth = 'min(90vw, 90vh)';
  card.style.width = '100%';
  layer.appendChild(card);
  document.body.appendChild(layer);

  let configs: SatelliteConfig[] = [];
  let active: SatelliteConfig | undefined;
  let shown: boolean | null = null;
  let hideTimer = 0;

  // The card pauses its WebGL loop with an IntersectionObserver, which only sees
  // geometry -- an opacity-0 layer still intersects, so hiding that way would
  // leave a 3D scene rendering full-tilt behind every page. display:none gives
  // it a zero box, which reads as off-screen and stops the loop. The card copes
  // with being built at zero size: its ResizeObserver reframes on the way in.
  const setShown = (visible: boolean) => {
    if (visible === shown) return;
    shown = visible;
    clearTimeout(hideTimer);
    const fade = active?.fade_ms ?? 220;
    if (visible) {
      layer.style.display = 'flex';
      // Flush the layout so the browser has an opacity-0 frame to animate from;
      // without it display and opacity land in one recalc and the fade is lost.
      void layer.offsetWidth;
      layer.style.opacity = '1';
    } else {
      layer.style.opacity = '0';
      hideTimer = window.setTimeout(() => {
        layer.style.display = 'none';
      }, fade);
    }
  };

  const adopt = (config: SatelliteConfig) => {
    card.setConfig(config.card);
    layer.style.alignItems = config.vertical_align;
    layer.style.zIndex = String(config.z_index);
    layer.style.pointerEvents = config.pass_through_taps ? 'none' : 'auto';
    layer.style.transition = `opacity ${config.fade_ms}ms ease`;
  };

  // Re-read the binding every tick rather than caching it: it is written when
  // you pick a satellite in the Voice Satellite panel, which can happen long
  // after this module started.
  const selectConfig = (): SatelliteConfig | undefined => {
    const bound = boundSatellite();
    const match = configs.find((config) => config.entity === bound);
    if (match) return match;
    // Nothing bound: only an entry that has opted out of the binding check can
    // claim this browser, which is what makes a desktop mirror possible.
    return configs.find((config) => !config.only_on_bound_device);
  };

  const apply = (current: HomeAssistant | undefined) => {
    if (!current) return;

    const next = selectConfig();
    if (next !== active) {
      active = next;
      if (active) adopt(active);
      else setShown(false);
    }
    if (!active) return;

    card.hass = current;                        // the card diffs internally
    const state = current.states[active.entity];
    setShown(!!state && active.show_states.includes(String(state.state).toLowerCase()));
  };

  const loadConfig = async () => {
    try {
      const result = await hass.connection.sendMessagePromise<{ satellites: SatelliteConfig[] }>({
        type: CONFIG_COMMAND,
      });
      configs = result?.satellites ?? [];
      log('loaded config for', configs.length, 'satellite(s)');
    } catch (error) {
      log('config fetch failed', error);
      configs = [];
    }
    // Drop the selection so the next apply() re-adopts against the new list.
    active = undefined;
    apply(ha.hass);
  };

  await loadConfig();

  // Poll first and unconditionally: ha.hass is replaced wholesale on every
  // update, so this alone keeps the card and its visibility correct. Registering
  // it before the subscriptions means a subscribe failure cannot freeze it.
  setInterval(() => apply(ha.hass), POLL_MS);

  // Event-driven on top, so changes land immediately rather than up to a second
  // later. Best-effort; the poll above is the safety net.
  try {
    void hass.connection.subscribeEvents<{ data: { entity_id?: string } }>((event) => {
      if (event?.data?.entity_id !== active?.entity) return;
      apply(ha.hass);
    }, 'state_changed');
    void hass.connection.subscribeEvents(() => void loadConfig(), CONFIG_EVENT);
  } catch (error) {
    log('subscribeEvents failed, falling back to polling', error);
  }

  log('mounted');
}

void main().catch((error) => console.error('[glados-3d-overlay] failed', error));
