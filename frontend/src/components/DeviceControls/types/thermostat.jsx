import React from 'react';
import { ClimatePanel } from '../panels/ClimatePanel';

/**
 * Default `thermostat` panel — per-type fallback for every climate-ish device
 * that does not advertise a control profile (including Home Assistant
 * `climate` / `water_heater` entities).
 *
 * Thin wrapper: the implementation lives in the shared `ClimatePanel`, so this
 * file only maps the registry key to a variant.
 */
export const ThermostatControls = (props) => (
    <ClimatePanel {...props} variant="default" />
);

export default ThermostatControls;
