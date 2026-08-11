# GLaDOS 3D Card

A 3D animated GLaDOS custom card for Home Assistant Lovelace dashboards. Renders the
GLaDOS model with Three.js, driven by voice assistant entity states and music sync.

> Unofficial fan project. Not affiliated with, authorised or endorsed by Valve
> Corporation. Code is MIT; the model is CC-BY-SA — see [Licence](#licence).

## Install via HACS (recommended)

**1. Add this repo to HACS.** HACS → ⋮ (top right) → **Custom repositories**.
Paste `https://github.com/grenadecx/GLaDOS-3D-Animation` and set the type to
**Dashboard** — that is HACS's category for a Lovelace card. Older guides call it
*Plugin* or *Lovelace*; it was renamed, and Dashboard is the same thing.

**2. Download it.** Search **GLaDOS 3D Card** in HACS → *Download*, then reload
your browser when prompted.

**3. Register the resource.** On a normal UI dashboard (storage mode) HACS does
this for you — skip to step 4. Only do this yourself if your dashboard is in YAML
mode, or if step 4 fails with *Custom element doesn't exist*:

```yaml
# configuration.yaml, under lovelace:
resources:
  - url: /hacsfiles/GLaDOS-3D-Animation/glados-3d-card.js
    type: module
```

Via the UI the same entry is Settings → Dashboards → ⋮ → **Resources** → *Add
resource*, with resource type **JavaScript module** — that is what `type: module`
means. (The other option, *JavaScript file*, is the legacy type; don't use it.)

**4. Add the card** to a dashboard:

```yaml
type: custom:glados-3d-card
entity: assist_satellite.living_room
media_entity: media_player.living_room
bpm_entity: sensor.living_room_bpm
```

The model is downloaded alongside the card, so `model_url` needs no override.

## Manual install

**1. Build** — or skip this and download `glados-3d-card.js` and `GLaDOS.glb`
from the [latest release](https://github.com/grenadecx/GLaDOS-3D-Animation/releases):

```bash
npm install
npm run build
```

**2. Copy the card and the model** into your Home Assistant `config/www/` folder:

```bash
cp dist/glados-3d-card.js /path/to/homeassistant/www/
cp dist/GLaDOS.glb /path/to/homeassistant/www/
```

**3. Register the resource** — Settings → Dashboards → ⋮ → **Resources** → *Add
resource*, URL `/local/glados-3d-card.js`, type **JavaScript module**. The YAML
equivalent, for a YAML-mode dashboard:

```yaml
resources:
  - url: /local/glados-3d-card.js
    type: module
```

**4. Add the card**, pointing `model_url` at the copy you made — the default path
is the HACS one, so this override is required for a manual install:

```yaml
type: custom:glados-3d-card
entity: assist_satellite.living_room
media_entity: media_player.living_room
bpm_entity: sensor.living_room_bpm
model_url: /local/GLaDOS.glb
```

## If the card doesn't appear

- **"Custom element doesn't exist: glados-3d-card"** — the resource isn't
  registered, or the browser cached the old dashboard. Check the Resources list,
  then hard-reload (Ctrl/Cmd + Shift + R).
- **Card renders but stays empty** — the GLB didn't load. Open the browser
  console; a 404 on the model means `model_url` is wrong. Paths are
  case-sensitive.

## Configuration

Every field below can be set from the visual editor — *Add card* → **GLaDOS 3D
Card**, or *Edit* on an existing card — or in YAML directly.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `entity` | string | *required* | Voice assistant entity ID |
| `media_entity` | string | — | Media player entity, for playback detection |
| `bpm_entity` | string | — | BPM sensor entity (defaults to 120 BPM) |
| `dance_style` | string | `auto` | `auto`, or one pinned move — see [Dancing](#dancing) |
| `model_url` | string | `/hacsfiles/GLaDOS-3D-Animation/GLaDOS.glb` | Path to the GLB |
| `bg_color` | string | `#0d0f14` | Scene background |
| `aspect_ratio` | number | `1.3333` | Card width ÷ height |
| `zoom` | number | `1` | Framing multiplier; >1 moves in |
| `yaw` | number | `-20` | Camera orbit, degrees |
| `pitch` | number | `5` | Camera elevation, degrees |
| `pan_x` / `pan_y` | number | `-0.5` / `0.5` | Slide the framing, in model radii |
| `bloom` | number | `0.9` | Eye bloom strength; `0` disables post-processing |
| `max_fps` | number | `60` | Frame rate cap; `0` renders every animation frame |

### BPM source — SongBPM

The card needs a real-time BPM sensor for music sync. The recommended source is
the [SongBPM integration](https://github.com/Axildor/GLaDOS-AI-Animation) — it
extracts the current track's BPM so GLaDOS dances at the exact tempo.

**1.** Install SongBPM via HACS (or from source) and configure it to pull BPM from
your music player.

**2.** Set `bpm_entity` to SongBPM's output sensor, e.g.:

```yaml
bpm_entity: sensor.universal_music_bpm
```

If `bpm_entity` is left empty the card falls back to a fixed **120 BPM**.

## States

Five states, with the eye colours taken from the 2D reference card
([Axildor/GLaDOS-AI-Animation](https://github.com/Axildor/GLaDOS-AI-Animation)).

**The assistant always takes precedence.** Listening, Computing and Speaking
override Dancing outright; when the assistant has nothing to do it is either
Standby or, if media is playing, Dancing. Interrupting the music stops the
BPM bounce as well as changing the colour — but the beat clock keeps running
underneath, so going back to Dancing rejoins the music where it actually is
instead of restarting the bar.

| Voice entity state | State | Eye | Motion |
|---|---|---|---|
| anything else | Standby | amber `#d95500` | slow breathing, dim eye |
| `listen*`, `wake*` | Active Listening | blue `#00ccff` | head turns to face you |
| `process*`, `think*` | Computing | orange `#ff6600` | head cocks back, rapid flicker |
| `respond*`, `speak*`, `tts*` | Speaking | red `#ff2200` | rhythmic nodding, pulsing eye |
| idle + media `playing` | Dancing | green `#1DB954` | choreography on the beat, see below |

Each eye is a radial gradient with a white-hot core, painted into the lens
texture and cross-faded on state changes. The matching colour also drives a
tight point light so the housing picks up the spill, and the bloom pass carries
it out into the surrounding glow.

### Dancing

`music.ts` is only a beat clock; the choreography lives in `animation.ts`, which
is the module that knows the rig. The dance runs along the whole chain — head,
neck, three spine segments, ceiling mount — built from four moves:

| Move | Motion |
|---|---|
| `sway` | Travelling wave. The head leads and each segment further back repeats the motion slightly later, so the body follows rather than whipping the head around. |
| `bounce` | A ball bounce once per beat, with the head stretching through the arc and squashing on the landing while the chain concertinas under it. |
| `headbang` | A sharp flex every two beats — fast plunge, slow recovery — leaning alternate ways on consecutive bangs. Unlike the others this one does *not* ramp linearly along the chain: the amplitude falls off as `k⁴`, so the head supplies about seven tenths of the travel and the spine stays near still. Ramped linearly it folded the whole body and read as a bow rather than a bang. |
| `wave` | A narrow pulse fired on each beat and lagged hard down the chain, so several are in flight at once and the ripple visibly travels like a row of dominoes. |

All four share the same skeleton. `lag` is how many beats the ceiling mount
trails the head by, spread along the chain — the larger it is, the more the motion
travels down the body instead of the chain moving as one. A slow swell across each
8-beat phrase keeps the loop off the metronome, and amplitude scales up with tempo
— a faster track is a more energetic one — clamped at both ends so a slow track
still moves and a very fast one stays inside the frame.

The head barely turns on its own in any of them. It sits at the end of a long
chain and already inherits every ancestor's rotation, so nearly all of its visible
travel comes from the body carrying it — under `sway`, roughly 2° of rotation of
its own against a metre of world travel. Bobs are plain curves on the beat rather
than the beat's attack/decay envelope, which read as a twitch.

#### The routine

On the default `dance_style: auto` she does not run one move at a track. A routine
holds a move for **one to three 8-beat phrases**, then cuts to a different one —
never the same twice running — cross-fading over a beat so the outgoing move
settles instead of snapping.

Everything it does is measured in beats off the same clock the moves read, never
in seconds. That is the whole trick: cuts land on the phrase boundaries a listener
is already feeling, they slow down with the track, and they stop dead when the
music is paused rather than shuffling on in silence. The grid is anchored to the
clock rather than to the card's start time, so a dashboard that loads mid-track
still cuts in time. And because the beat clock keeps running while the assistant
has the model, interrupting the music and coming back rejoins the routine at
whatever move the track has arrived at.

Picks are weighted by how well a move's energy suits the tempo — a soft gaussian
preference, never a gate, so nothing is ever ruled out:

| | `sway` | `wave` | `bounce` | `headbang` |
|---|---|---|---|---|
| **75 BPM** | 38% | 33% | 20% | 9% |
| **155 BPM** | 11% | 18% | 33% | 38% |

Setting `dance_style` to a move name pins it instead, which is the old behaviour
and useful for tuning one in isolation.

Adding a fifth move is a matter of writing one `DanceStep` function — offsets as a
function of where a bone sits on the chain and where the beat clock is — and
adding a row to the `CHOREOGRAPHY` table with its lag and energy. The routine
picks it up with no further changes.

Four cables (`Wires_Head_in`, `Wires_Out`, `Wires_In`, `BezierCurve024`) sit
outside the armature in the source blend, driven there by curve and hook
modifiers that glTF cannot express. They export as frozen geometry parked beside
the rig, which left a cable hanging motionless next to her face. `model.ts`
re-parents each onto the nearest bone at load, which costs nothing and makes them
travel with the body.

## The model

The card uses **`models/GLaDOS.glb`** — a glTF export of
["GladOS from Portal 2 Rigged Textured Updated"](https://blendswap.com/blend/4565)
by **BlenderCranium**, from BlendSwap, licensed **CC-BY-SA**. It is a rigged,
ceiling-mounted GLaDOS with an emissive eye, matching the blend's own
[reference render](https://blendswap.com/blend_previews/4565/0/0).

`models/GLaDOS.glb` is a format conversion of that blend, so it is an adaptation
and carries the same CC-BY-SA terms. See the [Licence](#licence) section below.

Two quirks of that blend are handled at load time in `src/model.ts`, and are worth
knowing if you swap in a different GLB:

- **Origin clutter.** The blend parks its material-preview props — colour clips,
  emissive lamp planes, PotatOS, a 42-unit test cylinder — at the world origin,
  directly on top of GLaDOS. `KEEP` lists the root nodes that are actually part of
  the character; the rest are dropped. The prune is skipped entirely if none of the
  `KEEP` names are present, so an unrelated model still loads.
- **Missing base colours.** The materials were procedural, so only the emissive ones
  survived the glTF export. Everything else arrives with no `baseColorFactor` and
  therefore the spec default of metalness 1 / roughness 1 — a pure metal with no
  diffuse response, which renders **black** without an environment map. `PALETTE`
  re-authors those materials by name, and `src/scene.ts` supplies a PMREM environment.

## Running on a phone

Two things keep the cost down, both on by default:

- **The render loop stops when the card is off-screen.** `requestAnimationFrame`
  is only throttled for a hidden *document* — a card that has merely been
  scrolled past on a long dashboard keeps rendering at full rate. An
  `IntersectionObserver` stops the loop outright and restarts it 150px before the
  card scrolls back into view.
- **`max_fps` caps the frame rate**, 60 by default. A 120 Hz phone would
  otherwise render this twice as often as it needs.

If you need more headroom, in rough order of saving per unit of visual loss:
lower `max_fps` to 30, drop `MSAA_SAMPLES` in `src/scene.ts` from 4 to 2, then
set `bloom: 0`. Memory is unlikely to be the constraint — a phone-sized card uses
about 78 MB of GPU memory and 74 draw calls per frame.

## Development

```bash
npm run build          # bundle to dist/
node test/server.mjs   # static server on :3000
```

- `http://localhost:3000/test` — the card with buttons for each voice state, a music
  toggle, and a BPM slider that feeds the simulated `sensor.glados_bpm`. The pip
  beside the slider flashes at the set tempo, so the model's bounce can be checked
  against a known beat; it lights up only while the card is actually Dancing. Any
  card option can be overridden from the query string, e.g. `/test?max_fps=30`, `?bloom=0`, `?zoom=1.3`.
  The **Style** dropdown swaps `dance_style` live, without rebuilding the scene, and
  reads out which move the routine is on plus the cross-fade percentage mid-cut.
  An FPS readout in the card’s top-left corner reports frames the card actually
  drew — not the browser’s animation-frame rate — alongside the active cap, and
  shows `paused` when the card is scrolled out of view.
- `http://localhost:3000/test/probe.html` — standalone model inspector for framing,
  lighting and material questions, with no card or rebuild in the loop. See the
  comment at the top of that file for its parameters.

## Licence

Two licences apply, to different parts of this repository.

**Source code** — MIT, see [`LICENSE`](LICENSE). Use it however you like.

**`models/GLaDOS.glb`** — CC-BY-SA, see [`models/LICENSE.txt`](models/LICENSE.txt).
A glTF conversion of ["GladOS from Portal 2 Rigged Textured Updated"](https://blendswap.com/blend/4565)
by **BlenderCranium** on BlendSwap. You may redistribute and adapt it, including
commercially, provided you keep the attribution, state your changes, and license
any further adaptation of the model under CC-BY-SA as well. ShareAlike reaches the
model file and derivatives of it — not the code that loads it, which is why the two
licences coexist here.

**Trademarks.** GLaDOS, Portal and Aperture Science are trademarks of Valve
Corporation. This project is unofficial fan work and is not affiliated with,
authorised, endorsed by, or in any way connected to Valve Corporation. The model
author's CC-BY-SA grant covers their own modelling work; nobody can license rights
they do not hold, so it conveys nothing in respect of Valve's character design or
marks. Distributing this as free fan software is the well-trodden path — attaching
money to it is not.
