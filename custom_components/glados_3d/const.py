"""Constants for the GLaDOS 3D integration."""

from __future__ import annotations

from typing import Any, Final

DOMAIN: Final[str] = "glados_3d"

# Kept in step with package.json and manifest.json by scripts/sync-version.mjs.
INTEGRATION_VERSION: Final[str] = "0.2.0"

# Where the bundled frontend is served, and what lives there.
URL_BASE: Final[str] = f"/{DOMAIN}"
CARD_FILENAME: Final[str] = "glados-3d-card.js"
OVERLAY_FILENAME: Final[str] = "glados-3d-overlay.js"

# Websocket command the overlay calls to learn about every configured satellite.
WS_CONFIG: Final[str] = f"{DOMAIN}/config"
# Fired when an entry's options change, so an edit in the UI reaches the screen
# without a reload.
EVENT_CONFIG_UPDATED: Final[str] = f"{DOMAIN}_config_updated"

# Entry data — the bindings, fixed when the entry is created.
CONF_ENTITY: Final[str] = "entity"
CONF_MEDIA_ENTITY: Final[str] = "media_entity"
CONF_BPM_ENTITY: Final[str] = "bpm_entity"

# Entry options — appearance, editable at any time.
CONF_SHOW_STATES: Final[str] = "show_states"
CONF_VERTICAL_ALIGN: Final[str] = "vertical_align"
CONF_ONLY_ON_BOUND_DEVICE: Final[str] = "only_on_bound_device"
CONF_FADE_MS: Final[str] = "fade_ms"
CONF_ZOOM: Final[str] = "zoom"
CONF_ASPECT_RATIO: Final[str] = "aspect_ratio"
CONF_DANCE_STYLE: Final[str] = "dance_style"
CONF_SHOW_STATUS: Final[str] = "show_status"
CONF_YAW: Final[str] = "yaw"
CONF_PITCH: Final[str] = "pitch"
CONF_PAN_X: Final[str] = "pan_x"
CONF_PAN_Y: Final[str] = "pan_y"
CONF_BLOOM: Final[str] = "bloom"
CONF_MAX_FPS: Final[str] = "max_fps"

# Satellite states that make her visible. "idle" is offered too, for anyone who
# wants her on screen permanently.
SATELLITE_STATES: Final[list[str]] = ["listening", "processing", "responding", "idle"]

# Offered as plain words and translated to CSS on the way out, so the form never
# shows anyone the word "flex-start".
VERTICAL_ALIGNS: Final[list[str]] = ["top", "center", "bottom"]
ALIGN_CSS: Final[dict[str, str]] = {
    "top": "flex-start",
    "center": "center",
    "bottom": "flex-end",
}

DANCE_STYLES: Final[list[str]] = ["auto", "sway", "bounce", "headbang", "wave"]

# Named framings, so the form offers exact ratios rather than a decimal a slider
# would round off. The key is what gets stored; the float is what the card wants.
ASPECT_RATIOS: Final[dict[str, float]] = {
    "21:9": 21 / 9,
    "16:9": 16 / 9,
    "3:2": 3 / 2,
    "4:3": 4 / 3,
    "1:1": 1.0,
    "3:4": 3 / 4,
}

# Not worth a form field, but still sent to the overlay.
#
# Voice Satellite's own overlay is already near the top of the stacking order, so
# this has to clear it to be visible at all.
Z_INDEX: Final[int] = 2147483000
# Taps fall through to whatever is underneath; she is decoration, not a control.
PASS_THROUGH_TAPS: Final[bool] = True

DEFAULT_OPTIONS: Final[dict[str, Any]] = {
    CONF_SHOW_STATES: ["listening", "processing", "responding"],
    CONF_VERTICAL_ALIGN: "top",
    CONF_ONLY_ON_BOUND_DEVICE: True,
    CONF_FADE_MS: 220,
    CONF_ZOOM: 1.0,
    CONF_ASPECT_RATIO: "1:1",
    CONF_DANCE_STYLE: "auto",
    # Voice Satellite already labels the state underneath her.
    CONF_SHOW_STATUS: False,
    CONF_YAW: -20.0,
    CONF_PITCH: 5.0,
    CONF_PAN_X: -0.5,
    CONF_PAN_Y: 0.5,
    CONF_BLOOM: 0.9,
    CONF_MAX_FPS: 60,
}
