"""Config flow for GLaDOS 3D.

One entry per satellite. The entry's data holds the bindings, which are fixed
once chosen; its options hold everything about how she looks, which the options
flow can revise at any time without a restart.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import (
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
    DANCE_STYLES,
    DEFAULT_OPTIONS,
    DOMAIN,
    SATELLITE_STATES,
    VERTICAL_ALIGNS,
)

BINDINGS_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_ENTITY): selector.EntitySelector(
            selector.EntitySelectorConfig(domain=["assist_satellite", "conversation"])
        ),
        vol.Optional(CONF_MEDIA_ENTITY): selector.EntitySelector(
            selector.EntitySelectorConfig(domain="media_player")
        ),
        vol.Optional(CONF_BPM_ENTITY): selector.EntitySelector(
            selector.EntitySelectorConfig(domain="sensor")
        ),
    }
)


def _select(options: list[str], key: str | None = None) -> selector.SelectSelector:
    """A dropdown, optionally with translated option labels.

    translation_key is only set when there is one: the selector validates it as a
    string, so passing None explicitly raises vol.Invalid — which surfaces as a
    bare HTTP 400 on the options flow, with nothing in the log to explain it.
    """
    config = selector.SelectSelectorConfig(
        options=options,
        mode=selector.SelectSelectorMode.DROPDOWN,
    )
    if key is not None:
        config["translation_key"] = key
    return selector.SelectSelector(config)


def _number(
    minimum: float, maximum: float, step: float
) -> selector.NumberSelector:
    return selector.NumberSelector(
        selector.NumberSelectorConfig(
            min=minimum,
            max=maximum,
            step=step,
            mode=selector.NumberSelectorMode.SLIDER,
        )
    )


def _options_schema(current: dict[str, Any]) -> vol.Schema:
    """Appearance form, pre-filled with whatever the entry already has."""

    def value(key: str) -> Any:
        return current.get(key, DEFAULT_OPTIONS[key])

    return vol.Schema(
        {
            vol.Required(CONF_VERTICAL_ALIGN, default=value(CONF_VERTICAL_ALIGN)): _select(
                VERTICAL_ALIGNS, "vertical_align"
            ),
            vol.Required(CONF_SHOW_STATES, default=value(CONF_SHOW_STATES)): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=SATELLITE_STATES,
                    multiple=True,
                    translation_key="satellite_states",
                )
            ),
            vol.Required(CONF_ASPECT_RATIO, default=value(CONF_ASPECT_RATIO)): _select(
                list(ASPECT_RATIOS)
            ),
            vol.Required(CONF_DANCE_STYLE, default=value(CONF_DANCE_STYLE)): _select(
                DANCE_STYLES, "dance_style"
            ),
            vol.Required(CONF_ZOOM, default=value(CONF_ZOOM)): _number(0.2, 3, 0.05),
            vol.Required(CONF_YAW, default=value(CONF_YAW)): _number(-180, 180, 1),
            vol.Required(CONF_PITCH, default=value(CONF_PITCH)): _number(-60, 60, 1),
            vol.Required(CONF_PAN_X, default=value(CONF_PAN_X)): _number(-2, 2, 0.05),
            vol.Required(CONF_PAN_Y, default=value(CONF_PAN_Y)): _number(-2, 2, 0.05),
            vol.Required(CONF_BLOOM, default=value(CONF_BLOOM)): _number(0, 3, 0.05),
            vol.Required(CONF_MAX_FPS, default=value(CONF_MAX_FPS)): _number(0, 120, 5),
            vol.Required(CONF_FADE_MS, default=value(CONF_FADE_MS)): _number(0, 1000, 10),
            vol.Required(
                CONF_SHOW_STATUS, default=value(CONF_SHOW_STATUS)
            ): selector.BooleanSelector(),
            vol.Required(
                CONF_ONLY_ON_BOUND_DEVICE, default=value(CONF_ONLY_ON_BOUND_DEVICE)
            ): selector.BooleanSelector(),
        }
    )


class Glados3DConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for GLaDOS 3D."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Bind an entry to one satellite."""
        if user_input is not None:
            entity = user_input[CONF_ENTITY]
            # The satellite is the identity of the entry: one overlay per screen.
            await self.async_set_unique_id(entity)
            self._abort_if_unique_id_configured()

            state = self.hass.states.get(entity)
            title = state.name if state else entity
            return self.async_create_entry(
                title=title, data=user_input, options=dict(DEFAULT_OPTIONS)
            )

        return self.async_show_form(step_id="user", data_schema=BINDINGS_SCHEMA)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Return the appearance flow."""
        return Glados3DOptionsFlow()


class Glados3DOptionsFlow(OptionsFlow):
    """Edit how she looks on this satellite."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)

        return self.async_show_form(
            step_id="init",
            data_schema=_options_schema(dict(self.config_entry.options)),
        )
