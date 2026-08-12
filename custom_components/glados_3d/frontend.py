"""Serving and registering the bundled frontend.

Two different jobs, because the card and the overlay reach the browser by
different routes:

  * the card is a Lovelace resource, so it is available to dashboards;
  * the overlay goes through frontend.add_extra_js_url, which is the only way to
    load a module on pages that are not dashboards -- Settings, Developer Tools,
    and the Voice Satellite panel itself.

Both URLs carry the integration version, so an update invalidates the browser
cache without anyone editing YAML.
"""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace.resources import ResourceStorageCollection
from homeassistant.core import HomeAssistant

from .const import (
    CARD_FILENAME,
    INTEGRATION_VERSION,
    OVERLAY_FILENAME,
    URL_BASE,
)

try:  # Not present on every HA version we support.
    from homeassistant.components.frontend import remove_extra_js_url
except ImportError:  # pragma: no cover
    remove_extra_js_url = None  # type: ignore[assignment]

_LOGGER = logging.getLogger(__name__)

FRONTEND_DIR = str(Path(__file__).parent / "frontend")

CARD_URL = f"{URL_BASE}/{CARD_FILENAME}"
OVERLAY_URL = f"{URL_BASE}/{OVERLAY_FILENAME}"
VERSIONED_CARD_URL = f"{CARD_URL}?v={INTEGRATION_VERSION}"
VERSIONED_OVERLAY_URL = f"{OVERLAY_URL}?v={INTEGRATION_VERSION}"

# Left behind when upgrading from the standalone HACS dashboard card. The files
# survive in www/community/, so without this the card module loads twice.
_LEGACY_RESOURCE_MARKERS = ("/hacsfiles/GLaDOS-3D-Animation/",)


def _resources(hass: HomeAssistant) -> ResourceStorageCollection | None:
    """The Lovelace resource collection, or None if not in storage mode."""
    lovelace = hass.data.get("lovelace")
    if lovelace is None:
        return None
    # Newer HA exposes an attribute; older HA kept a dict.
    resources = (
        lovelace.resources
        if hasattr(lovelace, "resources")
        else lovelace.get("resources") if isinstance(lovelace, dict) else None
    )
    if not isinstance(resources, ResourceStorageCollection):
        return None
    return resources


async def async_register_static_paths(hass: HomeAssistant) -> None:
    """Serve the built frontend directory at /glados_3d."""
    config = StaticPathConfig(URL_BASE, FRONTEND_DIR, False)
    try:
        await hass.http.async_register_static_paths([config])
        _LOGGER.debug("Static path registered: %s", URL_BASE)
    except RuntimeError:
        # A second config entry setting up, which is normal and harmless.
        _LOGGER.debug("Static path already registered: %s", URL_BASE)


def register_overlay(hass: HomeAssistant) -> None:
    """Load the overlay module on every page.

    The underlying store is a set, so calling this once per config entry adds
    exactly one URL.
    """
    add_extra_js_url(hass, VERSIONED_OVERLAY_URL)
    _LOGGER.debug("Overlay registered: %s", VERSIONED_OVERLAY_URL)


def unregister_overlay(hass: HomeAssistant) -> None:
    """Stop loading the overlay, if this HA version can."""
    if remove_extra_js_url is None:
        return
    remove_extra_js_url(hass, VERSIONED_OVERLAY_URL)


async def async_register_card_resource(hass: HomeAssistant) -> None:
    """Register or update the card in Lovelace resources."""
    resources = _resources(hass)
    if resources is None:
        # YAML-mode dashboards manage their own resources, so the best we can do
        # is load the card everywhere the overlay already goes.
        _LOGGER.debug("Lovelace resources unavailable, falling back to extra JS")
        add_extra_js_url(hass, VERSIONED_CARD_URL)
        return

    await resources.async_get_info()

    for item in list(resources.async_items()):
        url = item.get("url", "")
        if any(marker in url for marker in _LEGACY_RESOURCE_MARKERS):
            _LOGGER.warning("Removing legacy GLaDOS 3D resource: %s", url)
            await resources.async_delete_item(item["id"])

    for item in list(resources.async_items()):
        url = item.get("url", "")
        if url.split("?")[0] != CARD_URL:
            continue
        if url == VERSIONED_CARD_URL:
            _LOGGER.debug("Card resource already up to date")
            return
        _LOGGER.info("Updating card resource to v%s", INTEGRATION_VERSION)
        await resources.async_update_item(
            item["id"], {"url": VERSIONED_CARD_URL, "res_type": "module"}
        )
        return

    _LOGGER.info("Registering card resource: %s", VERSIONED_CARD_URL)
    await resources.async_create_item({"url": VERSIONED_CARD_URL, "res_type": "module"})


async def async_unregister_card_resource(hass: HomeAssistant) -> None:
    """Drop the card resource when the last entry goes away."""
    resources = _resources(hass)
    if resources is None:
        return
    await resources.async_get_info()
    for item in list(resources.async_items()):
        if item.get("url", "").split("?")[0] == CARD_URL:
            await resources.async_delete_item(item["id"])
            _LOGGER.debug("Card resource removed")
