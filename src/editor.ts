/**
 * Visual editor for the card, rendered by HA when the dashboard editor calls
 * Glados3DCard.getConfigElement(). Without it the card is YAML-only.
 *
 * `ha-form` and its selectors are supplied by the HA frontend at runtime, so
 * nothing here is bundled — the schema is plain data describing the fields, and
 * HA renders the matching pickers, sliders and inputs.
 */

import { LitElement, html, css } from 'lit';
import { property, state } from 'lit/decorators.js';
import { HomeAssistant } from 'custom-card-helpers';
import { Glados3DConfig, DanceStyle } from './types.js';
import { define } from './define.js';

/** Typed as a full record, so adding a choreography preset without a label here
 *  is a compile error rather than a style missing from the dropdown. */
const DANCE_STYLE_LABELS: Record<DanceStyle, string> = {
  'auto': 'Auto — cut between all moves on the beat (default)',
  'sway': 'Sway — travelling wave',
  'bounce': 'Bounce — vertical, with squash and stretch',
  'headbang': 'Headbang — sharp head flex on the beat',
  'wave': 'Wave — domino ripple down the chain',
};

const DANCE_STYLE_OPTIONS = Object.entries(DANCE_STYLE_LABELS)
  .map(([value, label]) => ({ value, label }));

/** Named framings, so the dropdown offers exact ratios rather than a decimal a
 *  slider would round off. YAML may still set any number — see `aspectKey`. */
const ASPECT_PRESETS = [
  { key: '21:9', value: 21 / 9, label: '21:9 — ultrawide' },
  { key: '16:9', value: 16 / 9, label: '16:9 — widescreen' },
  { key: '3:2', value: 3 / 2, label: '3:2' },
  { key: '4:3', value: 4 / 3, label: '4:3 — default' },
  { key: '1:1', value: 1, label: '1:1 — square' },
  { key: '3:4', value: 3 / 4, label: '3:4 — portrait' },
] as const;

const CUSTOM_ASPECT = 'custom';

/** Which dropdown entry a stored number corresponds to. Anything that is not a
 *  preset reads back as `custom`, which the editor leaves untouched. */
function aspectKey(ratio?: number): string | undefined {
  if (typeof ratio !== 'number') return undefined;
  return ASPECT_PRESETS.find((p) => Math.abs(p.value - ratio) < 0.005)?.key ?? CUSTOM_ASPECT;
}

function aspectOptions(ratio?: number) {
  const options = ASPECT_PRESETS.map(({ key, label }) => ({ value: key, label }));
  if (aspectKey(ratio) !== CUSTOM_ASPECT) return options;
  return [...options, { value: CUSTOM_ASPECT, label: `Custom — ${ratio!.toFixed(3)} (from YAML)` }];
}

const buildSchema = (config: { aspect_ratio?: number; transparent_bg?: boolean }) => [
  { name: 'entity', required: true, selector: { entity: { domain: ['assist_satellite', 'conversation'] } } },
  { name: 'media_entity', selector: { entity: { domain: 'media_player' } } },
  { name: 'bpm_entity', selector: { entity: { domain: 'sensor' } } },
  { name: 'dance_style', selector: { select: { mode: 'dropdown', options: DANCE_STYLE_OPTIONS } } },
  {
    name: 'aspect_ratio',
    selector: { select: { mode: 'dropdown', options: aspectOptions(config.aspect_ratio) } },
  },
  { name: 'transparent_bg', selector: { boolean: {} } },
  { name: 'show_status', selector: { boolean: {} } },
  // ha-form keeps every key it was handed, so dropping the row while transparent
  // hides the dead control without losing the colour underneath it.
  ...(config.transparent_bg ? [] : [{ name: 'bg_color', selector: { color_rgb: {} } }]),
  { name: 'model_url', selector: { text: {} } },
  {
    name: '',
    type: 'grid',
    schema: [
      { name: 'zoom', selector: { number: { min: 0.2, max: 3, step: 0.05, mode: 'slider' } } },
      { name: 'yaw', selector: { number: { min: -180, max: 180, step: 1, mode: 'slider' } } },
      { name: 'pitch', selector: { number: { min: -60, max: 60, step: 1, mode: 'slider' } } },
      { name: 'pan_x', selector: { number: { min: -2, max: 2, step: 0.05, mode: 'slider' } } },
      { name: 'pan_y', selector: { number: { min: -2, max: 2, step: 0.05, mode: 'slider' } } },
      { name: 'bloom', selector: { number: { min: 0, max: 3, step: 0.05, mode: 'slider' } } },
      { name: 'max_fps', selector: { number: { min: 0, max: 120, step: 5, mode: 'slider' } } },
    ],
  },
];

type Rgb = [number, number, number];

/** The colour swatch speaks [r, g, b]; the card config stores hex. */
const HEX = /^#?([\da-f]{3}|[\da-f]{6})$/i;

function hexToRgb(hex?: string): Rgb | undefined {
  const match = hex?.match(HEX);
  if (!match) return undefined;
  const digits = match[1].length === 3 ? match[1].replace(/./g, (d) => d + d) : match[1];
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
}

function rgbToHex(rgb: unknown): string | undefined {
  const channels: unknown[] = Array.isArray(rgb) ? rgb : [];
  if (channels.length !== 3 || !channels.every((c) => typeof c === 'number')) {
    return undefined;
  }
  return `#${channels.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
}

const LABELS: Record<string, string> = {
  entity: 'Voice assistant entity (required)',
  media_entity: 'Media player',
  bpm_entity: 'BPM sensor',
  dance_style: 'Dance style',
  zoom: 'Zoom',
  aspect_ratio: 'Aspect ratio',
  yaw: 'Yaw (°)',
  pitch: 'Pitch (°)',
  pan_x: 'Pan X',
  pan_y: 'Pan Y',
  bloom: 'Eye bloom',
  max_fps: 'Max FPS (0 = uncapped)',
  bg_color: 'Background colour',
  transparent_bg: 'Transparent background (blend into the dashboard)',
  show_status: 'Show the state readout',
  model_url: 'Model URL',
};

export class Glados3DCardEditor extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config?: Glados3DConfig;

  public setConfig(config: Glados3DConfig): void {
    this._config = config;
  }

  static styles = css`
    ha-form {
      display: block;
    }
  `;

  protected render() {
    if (!this.hass || !this._config) return html``;

    return html`
      <ha-form
        .hass=${this.hass}
        .data=${{
          ...this._config,
          bg_color: hexToRgb(this._config.bg_color),
          aspect_ratio: aspectKey(this._config.aspect_ratio),
        }}
        .schema=${buildSchema(this._config)}
        .computeLabel=${this._computeLabel}
        @value-changed=${this._valueChanged}
      ></ha-form>
    `;
  }

  private _computeLabel = (schema: { name: string }): string => LABELS[schema.name] ?? schema.name;

  private _valueChanged = (ev: CustomEvent<{ value: Record<string, unknown> }>): void => {
    const config: Record<string, unknown> = { ...ev.detail.value };
    const hex = rgbToHex(config.bg_color);
    if (hex) {
      config.bg_color = hex;
    } else {
      delete config.bg_color;
    }

    const preset = ASPECT_PRESETS.find((p) => p.key === config.aspect_ratio);
    if (preset) {
      config.aspect_ratio = preset.value;
    } else if (config.aspect_ratio === CUSTOM_ASPECT) {
      config.aspect_ratio = this._config?.aspect_ratio;
    } else {
      delete config.aspect_ratio;
    }

    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

define('glados-3d-card-editor', Glados3DCardEditor);
