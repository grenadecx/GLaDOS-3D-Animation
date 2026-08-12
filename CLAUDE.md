# GLaDOS 3D — CLAUDE.md

## Conventional Commits

All commits should use conventional commit format: `type: short description`. Types: `feat`, `fix`, `chore`, `ci`, `docs`, `refactor`, `test`. Keep messages short and concise.

## Project

A Home Assistant **integration** (HACS category: Integration) that ships a 3D
animated GLaDOS model (Three.js + Lit) driven by voice assistant entity states
and music sync. It provides two frontends:

- a Lovelace card, for dashboards;
- a full-screen voice overlay, loaded on every page via `add_extra_js_url`, shown
  while a Voice Satellite is listening / processing / responding.

Config lives in config entries — **one per satellite**, so each screen can frame
her differently. The overlay picks its entry by the satellite Voice Satellite has
bound that browser to (`vs-satellite-entity` in localStorage).

## Build & Run

```bash
npm install
npm run build          # bundles into custom_components/glados_3d/frontend/
npm start              # watch mode
npm run typecheck      # tsc --noEmit — the build does NOT fail on type errors
npm run lint           # eslint, type-checked rules
node test/server.mjs   # dev server on :3000 → /test, /test/probe.html
```

## Source Layout

| File | Purpose |
|------|---------|
| `src/glados-card.ts` | Lit card element, HA integration |
| `src/overlay.ts` | The full-screen voice overlay; reads config over websocket |
| `src/define.ts` | Guarded `customElements.define` — the card loads by more than one URL |
| `src/editor.ts` | Visual config editor — `ha-form` schema, rendered by HA |
| `src/scene.ts` | Three.js scene setup, PMREM environment |
| `src/model.ts` | GLB load, origin prune, material palette fix, wire re-parent |
| `src/states.ts` | State machine: Standby → Listening → Computing → Speaking → Dancing |
| `src/animation.ts` | Dance moves on the bone chain, plus the routine that cuts between them |
| `src/music.ts` | Beat clock; drives BPM from a sensor entity |
| `src/types.ts` | Shared TypeScript types |
| `custom_components/glados_3d/__init__.py` | Entry setup, `glados_3d/config` websocket command |
| `custom_components/glados_3d/config_flow.py` | Bindings flow + appearance options flow |
| `custom_components/glados_3d/frontend.py` | Static paths, Lovelace resource, overlay registration, legacy cleanup |
| `custom_components/glados_3d/const.py` | Domain, option keys, defaults, `INTEGRATION_VERSION` |

## Packaging

HACS installs an integration by extracting the release zip straight into
`custom_components/glados_3d/`, so the zip contents sit at its **root**. The
Python is committed; the bundles and the GLB are built at release time and are
gitignored. `scripts/sync-version.mjs` keeps `package.json`, `manifest.json` and
`const.py` on one version — `const.py` stamps the `?v=` on the served URLs, so a
drift there ships an update no browser picks up.

## Gotchas

- Never pass `translation_key=None` to a selector config. It is validated as a
  string, so `None` raises `vol.Invalid` inside the step, which HA surfaces as a
  bare HTTP 400 with **nothing in the log**. Only set the key when there is one.
- The overlay hides with `display: none`, not `visibility: hidden`. The card
  pauses its WebGL loop with an IntersectionObserver, which only sees geometry —
  an opacity-0 layer still intersects and would render at full rate behind every
  page.
- Element registration goes through `define()`. The card legitimately arrives
  under more than one URL, and the browser treats each as a separate module, so a
  bare `customElements.define` throws on the second and takes the card down.

## Key Config Fields

`entity`, `media_entity`, `bpm_entity`, `model_url`, `bg_color`, `transparent_bg`,
`show_status`, `aspect_ratio`, `zoom`, `yaw`, `pitch`, `pan_x`, `pan_y`, `bloom`,
`max_fps`, `dance_style`

`transparent_bg` drops the scene background and the `ha-card` chrome so the model
sits on the dashboard. It needs an alpha WebGL context and a bloom blend that
leaves the destination alpha alone — see `preserveAlpha` in `src/scene.ts`.

`dance_style` is `auto` (default — a routine cuts between all moves on 8-beat
phrase boundaries) or one pinned move: `sway`, `bounce`, `headbang`, `wave`. See
`CHOREOGRAPHY` and `initRoutine` in `src/animation.ts`.

## Dev Tips

- Override card options from the test page query string: `/test?max_fps=30&bloom=0`
- `MSAA_SAMPLES` is in `src/scene.ts` (default 4)
- The model (`models/GLaDOS.glb`) is CC-BY-SA — do not modify or redistribute without preserving the licence
- Source code is MIT

## Eye Colours by State

| State | Colour |
|-------|--------|
| Standby | `#d95500` amber |
| Listening | `#00ccff` blue |
| Computing | `#ff6600` orange |
| Speaking | `#ff2200` red |
| Dancing | `#1DB954` green |
