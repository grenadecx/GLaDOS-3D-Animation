/**
 * glados-card.ts — LitElement web component for the 3D GLaDOS Lovelace card.
 *
 *   setConfig -> firstUpdated (scene + model) -> rAF loop -> disconnectedCallback
 *
 * HA entity state arrives through the `hass` setter, is cached to skip redundant
 * work, and is mapped to an animation state that the rAF loop interpolates toward.
 */

import { LitElement, html, css, PropertyValues } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { HomeAssistant } from 'custom-card-helpers';
import { Glados3DConfig, GladosState } from './types.js';
import { initScene, frameCamera, SceneHandles } from './scene.js';
import { loadModel, ModelHandles } from './model.js';
import { initAnimation, AnimationHandles } from './animation.js';
import { determineState, isMediaPlaying } from './states.js';
import { initMusic, parseBpmEntityValue, MusicHandles } from './music.js';
import { createPortals, PortalHandles } from './portal.js';

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: 'glados-3d-card',
  name: 'GLaDOS 3D Card',
  description: '3D animated GLaDOS card with HA entity sync and music reactivity',
});

const DEFAULTS: Omit<Glados3DConfig, 'type'> = {
  entity: 'conversation.default',
  media_entity: '',
  bpm_entity: '',
  zoom: 1.0,
  model_url: '/local/models/GLaDOS.glb',
  bg_color: '#0d0f14',
  yaw: -20,
  pitch: 5,
  pan_x: -0.5,
  pan_y: 0.5,
  bloom: 0.9,
  max_fps: 60,
  aspect_ratio: 4 / 3,
  portals: false,
};

/** Fraction of the vertical view the head fills at zoom 1. */
const BASE_FILL = 0.375;

/** Frame budget tolerance. A 120 Hz display ticks at 8.33 ms, so an exact
 *  16.67 ms test for 60 fps would reject the 16.67 ms tick on jitter and halve
 *  the rate to 30. A couple of milliseconds of slack keeps the cadence honest. */
const FRAME_SLACK_MS = 2;

/** Resume slightly before the card scrolls into view, so it is already moving. */
const VISIBILITY_MARGIN = '150px';

@customElement('glados-3d-card')
export class Glados3DCard extends LitElement {
  public static getStubConfig(): Record<string, unknown> {
    return { type: 'glados-3d-card', ...DEFAULTS };
  }

  @state() private _config!: Glados3DConfig;
  @state() private _gladosState: GladosState = 'standby';

  private _canvas: HTMLCanvasElement | null = null;
  private _scene: SceneHandles | null = null;
  private _model: ModelHandles | null = null;
  private _animation: AnimationHandles = initAnimation();
  private _music: MusicHandles = initMusic();
  private _portals: PortalHandles = createPortals();

  private _hass: HomeAssistant | undefined;
  private _lastVoice: string | undefined;
  private _lastMedia: string | undefined;
  private _lastBpm = 120;

  private _frameId = 0;
  private _resizeObserver: ResizeObserver | null = null;
  private _visibilityObserver: IntersectionObserver | null = null;
  private _lastFrameTime = 0;
  private _onScreen = true;
  private _destroyed = false;

  setConfig(config: Glados3DConfig): void {
    if (!config || !config.entity) throw new Error('glados-3d-card: "entity" is required');
    this._config = { ...DEFAULTS, ...config } as Glados3DConfig;
  }

  public getCardSize(): number {
    return 6;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._destroyed = false;
    // Lovelace re-parents cards when a view re-renders, which fires
    // disconnected -> connected without a second firstUpdated. Rebuild whatever
    // the disconnect tore down.
    if (this._canvas && !this._scene) this._setup();
    this._startLoop();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopLoop();
    // Only a genuine removal should cost a WebGL context teardown, so let a
    // re-parent settle first.
    setTimeout(() => { if (!this.isConnected) this._destroy(); }, 0);
  }

  firstUpdated(_changed: PropertyValues): void {
    this._canvas = this.renderRoot.querySelector('canvas');
    if (this._canvas) this._setup();
  }

  private _setup(): void {
    if (!this._canvas) return;

    this._scene = initScene(this._canvas, this._config);
    this._scene.scene.add(this._portals.group);

    this._resizeObserver = new ResizeObserver(() => {
      this._scene?.resize();
      this._frameModel();
    });
    this._resizeObserver.observe(this);

    // requestAnimationFrame keeps firing for a card that has merely been
    // scrolled past — only a hidden document throttles it. On a long dashboard
    // that is a full frame rate of invisible work, so stop the loop outright.
    this._visibilityObserver = new IntersectionObserver(
      (entries) => this._setOnScreen(entries.some((e) => e.isIntersecting)),
      { rootMargin: VISIBILITY_MARGIN }
    );
    this._visibilityObserver.observe(this);

    void this._loadModel();
  }

  private _setOnScreen(onScreen: boolean): void {
    if (onScreen === this._onScreen) return;
    this._onScreen = onScreen;
    if (onScreen) {
      // Drop the stale timestamp so the first frame back doesn't bill the
      // animation for however long the card spent off-screen.
      this._lastFrameTime = 0;
      this._startLoop();
    } else {
      this._stopLoop();
    }
  }

  private _stopLoop(): void {
    if (this._frameId) cancelAnimationFrame(this._frameId);
    this._frameId = 0;
    this._lastFrameTime = 0;
  }

  render() {
    return html`
      <ha-card style="--glados-aspect: ${this._config?.aspect_ratio ?? DEFAULTS.aspect_ratio}">
        <div class="stage">
          <canvas></canvas>
          <div class="status">
            <span class="dot" style="background: ${STATUS_COLORS[this._gladosState]}"></span>
            <span class="label">${this._gladosState}</span>
          </div>
        </div>
      </ha-card>
    `;
  }

  static get styles() {
    return css`
      :host { display: block; }
      ha-card { overflow: hidden; }
      .stage {
        position: relative;
        width: 100%;
        aspect-ratio: var(--glados-aspect, 1.3333);
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
      .status {
        position: absolute;
        bottom: 8px;
        right: 10px;
        display: flex;
        align-items: center;
        gap: 6px;
        font-family: var(--code-font-family, monospace);
        font-size: 10px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.55);
        pointer-events: none;
      }
      .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        animation: pulse 2s ease-in-out infinite;
      }
      @keyframes pulse {
        0%, 100% { opacity: 0.35; }
        50% { opacity: 1; }
      }
    `;
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  set hass(hass: HomeAssistant | undefined) {
    this._hass = hass;
    if (!hass || !this._config) return;

    const voice = hass.states[this._config.entity]?.state;
    const media = this._config.media_entity ? hass.states[this._config.media_entity]?.state : undefined;

    let bpm = this._lastBpm;
    if (this._config.bpm_entity) {
      const entity = hass.states[this._config.bpm_entity];
      if (entity?.state !== undefined) bpm = parseBpmEntityValue(String(entity.state));
    }

    if (voice === this._lastVoice && media === this._lastMedia && bpm === this._lastBpm) return;

    const bpmChanged = bpm !== this._lastBpm;
    this._lastVoice = voice;
    this._lastMedia = media;
    this._lastBpm = bpm;

    this._gladosState = determineState(voice, media);

    const playing = isMediaPlaying(media);
    if (playing !== this._music.isPlaying) this._music.setPlaying(playing);
    if (bpmChanged) this._music.setBpm(bpm);

    if (this._config.portals) {
      this._portals.updateVisibility(
        this._gladosState === 'speaking' ||
        this._gladosState === 'computing' ||
        this._gladosState === 'dancing'
      );
    }
  }

  private _startLoop(): void {
    if (this._frameId || this._destroyed || !this._onScreen) return;

    const maxFps = this._config?.max_fps ?? DEFAULTS.max_fps!;
    const minFrameMs = maxFps > 0 ? 1000 / maxFps - FRAME_SLACK_MS : 0;

    const loop = (timestamp: number) => {
      if (this._destroyed) return;
      this._frameId = requestAnimationFrame(loop);

      // Skip the frame entirely when it arrives inside the budget — no state
      // advance, so dt stays honest for whichever frame does get rendered.
      const elapsed = this._lastFrameTime ? timestamp - this._lastFrameTime : Infinity;
      if (elapsed < minFrameMs) return;

      const dt = this._lastFrameTime ? Math.min(elapsed / 1000, 0.1) : 0;
      this._lastFrameTime = timestamp;

      // The beat clock keeps running whatever the state, so that returning to
      // Dancing picks the music up where it actually is rather than restarting.
      // animation.ts decides how much of the dance actually shows.
      this._music.update(dt);
      this._animation.update(dt, this._gladosState, this._music.beat);

      if (!this._scene) return;
      if (this._model) this._animation.apply(this._model.rig);
      if (this._portals.group.visible) {
        this._portals.updateState(this._gladosState, this._music.beat.intensity);
      }
      this._scene.render();
    };
    this._frameId = requestAnimationFrame(loop);
  }

  private async _loadModel(): Promise<void> {
    if (!this._scene) return;
    try {
      this._model = await loadModel(this._scene.scene, this._config.model_url || DEFAULTS.model_url!);
      this._frameModel();
    } catch (error) {
      console.error('[glados-3d-card] model load failed:', error);
    }
  }

  private _frameModel(): void {
    if (!this._scene || !this._model) return;
    const { center, radius } = this._model.frame;
    const deg = Math.PI / 180;
    frameCamera(
      this._scene.camera,
      center,
      radius,
      BASE_FILL * (this._config.zoom ?? 1),
      (this._config.yaw ?? 0) * deg,
      (this._config.pitch ?? 0) * deg,
      this._config.pan_x ?? DEFAULTS.pan_x!,
      this._config.pan_y ?? DEFAULTS.pan_y!
    );
    this._portals.group.position.copy(center);
    this._portals.group.scale.setScalar(radius);
  }

  private _destroy(): void {
    this._destroyed = true;
    this._stopLoop();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._visibilityObserver?.disconnect();
    this._visibilityObserver = null;
    this._model?.dispose();
    this._model = null;
    this._scene?.dispose();
    this._scene = null;
  }
}

/** Matches the reference card's LED colour per state. */
const STATUS_COLORS: Record<GladosState, string> = {
  'standby': '#ffb800',
  'active-listening': '#00ccff',
  'computing': '#ff6600',
  'speaking': '#ff2200',
  'dancing': '#1db954',
};
