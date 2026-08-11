/**
 * Visual editor for the card, rendered by HA when the dashboard editor calls
 * Glados3DCard.getConfigElement(). Without it the card is YAML-only.
 *
 * `ha-form` and its selectors are supplied by the HA frontend at runtime, so
 * nothing here is bundled — the schema is plain data describing the fields, and
 * HA renders the matching pickers, sliders and inputs.
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HomeAssistant } from 'custom-card-helpers';
import { Glados3DConfig, DanceStyle } from './types.js';

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

const SCHEMA = [
  { name: 'entity', required: true, selector: { entity: { domain: ['assist_satellite', 'conversation'] } } },
  { name: 'media_entity', selector: { entity: { domain: 'media_player' } } },
  { name: 'bpm_entity', selector: { entity: { domain: 'sensor' } } },
  { name: 'dance_style', selector: { select: { mode: 'dropdown', options: DANCE_STYLE_OPTIONS } } },
  {
    name: '',
    type: 'grid',
    schema: [
      { name: 'zoom', selector: { number: { min: 0.2, max: 3, step: 0.05, mode: 'slider' } } },
      { name: 'aspect_ratio', selector: { number: { min: 0.5, max: 3, step: 0.01, mode: 'box' } } },
      { name: 'yaw', selector: { number: { min: -180, max: 180, step: 1, mode: 'slider' } } },
      { name: 'pitch', selector: { number: { min: -60, max: 60, step: 1, mode: 'slider' } } },
      { name: 'pan_x', selector: { number: { min: -2, max: 2, step: 0.05, mode: 'slider' } } },
      { name: 'pan_y', selector: { number: { min: -2, max: 2, step: 0.05, mode: 'slider' } } },
      { name: 'bloom', selector: { number: { min: 0, max: 3, step: 0.05, mode: 'slider' } } },
      { name: 'max_fps', selector: { number: { min: 0, max: 120, step: 5, mode: 'slider' } } },
    ],
  },
  { name: 'bg_color', selector: { color_rgb: {} } },
  { name: 'model_url', selector: { text: {} } },
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
  if (!Array.isArray(rgb) || rgb.length !== 3 || rgb.some((c) => typeof c !== 'number')) {
    return undefined;
  }
  return `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
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
  model_url: 'Model URL',
};

@customElement('glados-3d-card-editor')
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
        .data=${{ ...this._config, bg_color: hexToRgb(this._config.bg_color) }}
        .schema=${SCHEMA}
        .computeLabel=${this._computeLabel}
        @value-changed=${this._valueChanged}
      ></ha-form>
    `;
  }

  private _computeLabel = (schema: { name: string }): string => LABELS[schema.name] ?? schema.name;

  private _valueChanged(ev: CustomEvent): void {
    const config = { ...ev.detail.value };
    const hex = rgbToHex(config.bg_color);
    if (hex) {
      config.bg_color = hex;
    } else {
      delete config.bg_color;
    }

    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config },
        bubbles: true,
        composed: true,
      }),
    );
  }
}
