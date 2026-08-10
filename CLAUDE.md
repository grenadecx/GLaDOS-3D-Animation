# GLaDOS 3D Card — CLAUDE.md

## Conventional Commits

All commits should use conventional commit format: `type: short description`. Types: `feat`, `fix`, `chore`, `ci`, `docs`, `refactor`, `test`. Keep messages short and concise.

## Project

A custom Home Assistant Lovelace card that renders a 3D animated GLaDOS model
(Three.js + Lit) driven by voice assistant entity states and music sync.

## Build & Run

```bash
npm install
npm run build          # bundle to dist/glados-3d-card.js
npm start              # watch mode
node test/server.mjs   # dev server on :3000 → /test, /test/probe.html
```

## Source Layout

| File | Purpose |
|------|---------|
| `src/glados-card.ts` | Lit card element, HA integration |
| `src/editor.ts` | Visual config editor — `ha-form` schema, rendered by HA |
| `src/scene.ts` | Three.js scene setup, PMREM environment |
| `src/model.ts` | GLB load, origin prune, material palette fix, wire re-parent |
| `src/states.ts` | State machine: Standby → Listening → Computing → Speaking → Dancing |
| `src/animation.ts` | Travelling-wave dance choreography on the bone chain |
| `src/music.ts` | Beat clock; drives BPM from a sensor entity |
| `src/types.ts` | Shared TypeScript types |

## Key Config Fields

`entity`, `media_entity`, `bpm_entity`, `model_url`, `bg_color`, `aspect_ratio`,
`zoom`, `yaw`, `pitch`, `pan_x`, `pan_y`, `bloom`, `max_fps`

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
