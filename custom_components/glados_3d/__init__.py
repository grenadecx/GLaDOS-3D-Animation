"""GLaDOS 3D — a 3D GLaDOS overlay for Voice Satellite screens.

Ships the card and the overlay, serves both, and hands the browser one config
per satellite over a websocket command. Editing an entry's options fires an
event rather than reloading anything, so a change in the UI reaches every screen
without a reload, let alone a restart.
"""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv

from .const import (
    ALIGN_CSS,
    ASPECT_RATIOS,
    CONF_ASPECT_RATIO,
    CONF_BLOOM,
    CONF_BPM_ENTITY,
    CONF_DANCE_STYLE,
    CONF_ENTITY,
    CONF_FADE_MS,
    CONF_MAX_FPS,
    CONF_MEDIA_ENTITY,
    CONF_ONLY_ON_BOUND_DEVICE,
    CONF_PAN_X,
    CONF_PAN_Y,
    CONF_PITCH,
    CONF_SHOW_STATES,
    CONF_SHOW_STATUS,
    CONF_VERTICAL_ALIGN,
    CONF_YAW,
    CONF_ZOOM,
    DEFAULT_OPTIONS,
    DOMAIN,
    EVENT_CONFIG_UPDATED,
    PASS_THROUGH_TAPS,
    WS_CONFIG,
    Z_INDEX,
)
from .frontend import (
    async_register_card_resource,
    async_register_static_paths,
    async_unregister_card_resource,
    register_overlay,
    unregister_overlay,
)

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

_WS_REGISTERED = f"{DOMAIN}_ws_registered"


def _payload(entry: ConfigEntry) -> dict[str, Any]:
    """One satellite's settings, in the shape the overlay expects."""
    options = {**DEFAULT_OPTIONS, **entry.options}
    data = entry.data
    entity = data[CONF_ENTITY]

    return {
        "entity": entity,
        "show_states": list(options[CONF_SHOW_STATES]),
        "vertical_align": ALIGN_CSS.get(options[CONF_VERTICAL_ALIGN], "flex-start"),
        "only_on_bound_device": bool(options[CONF_ONLY_ON_BOUND_DEVICE]),
        "pass_through_taps": PASS_THROUGH_TAPS,
        "fade_ms": int(options[CONF_FADE_MS]),
        "z_index": Z_INDEX,
        "card": {
            "type": "custom:glados-3d-card",
            "entity": entity,
            "media_entity": data.get(CONF_MEDIA_ENTITY, ""),
            "bpm_entity": data.get(CONF_BPM_ENTITY, ""),
            # Not configurable: an overlay with a background would black out the
            # page behind her.
            "transparent_bg": True,
            "show_status": bool(options[CONF_SHOW_STATUS]),
            "aspect_ratio": ASPECT_RATIOS.get(options[CONF_ASPECT_RATIO], 1.0),
            "zoom": float(options[CONF_ZOOM]),
            "yaw": float(options[CONF_YAW]),
            "pitch": float(options[CONF_PITCH]),
            "pan_x": float(options[CONF_PAN_X]),
            "pan_y": float(options[CONF_PAN_Y]),
            "bloom": float(options[CONF_BLOOM]),
            "max_fps": int(options[CONF_MAX_FPS]),
            "dance_style": options[CONF_DANCE_STYLE],
        },
    }


@websocket_api.websocket_command({vol.Required("type"): WS_CONFIG})
@callback
def ws_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return every configured satellite. The browser picks its own.

    Keyed off our own registry rather than ConfigEntryState: an entry is only
    marked LOADED after async_setup_entry returns, so a state check here would
    race with the very setup that announces it.
    """
    active = hass.data.get(DOMAIN, {})
    satellites = [
        _payload(entry)
        for entry in hass.config_entries.async_entries(DOMAIN)
        if entry.entry_id in active
    ]
    connection.send_result(msg["id"], {"satellites": satellites})


@callback
def _notify(hass: HomeAssistant) -> None:
    """Tell every open browser to re-read its config."""
    hass.bus.async_fire(EVENT_CONFIG_UPDATED)


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Push an options edit out live, without reloading the entry."""
    _notify(hass)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up a satellite entry."""
    await async_register_static_paths(hass)
    await async_register_card_resource(hass)
    register_overlay(hass)

    if not hass.data.get(_WS_REGISTERED):
        websocket_api.async_register_command(hass, ws_config)
        hass.data[_WS_REGISTERED] = True

    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = True

    _notify(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Tear down a satellite entry."""
    entries = hass.data.get(DOMAIN, {})
    entries.pop(entry.entry_id, None)

    if not entries:
        await async_unregister_card_resource(hass)
        unregister_overlay(hass)

    _notify(hass)
    return True
