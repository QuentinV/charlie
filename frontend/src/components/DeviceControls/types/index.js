import { LightControls } from './light';
import { SwitchControls } from './switch';
import { ShutterControls } from './shutter';
import { SprinklerControls } from './sprinkler';
import { TVDefaultControls } from './tv';
import { SensorControls } from './sensor';
import { ThermostatControls } from './thermostat';
import { ButtonControls } from './button';

/**
 * Registry of default per-device-type control panels, keyed by `DeviceType`.
 * Provider-specific overrides (`CUSTOM_CONTROLS` in DeviceControls) always
 * take precedence; types without an entry fall back to the generic
 * capabilities renderer.
 */
export const TYPE_CONTROLS = {
    light: LightControls,
    switch: SwitchControls,
    shutter: ShutterControls,
    sprinkler: SprinklerControls,
    tv: TVDefaultControls,
    sensor: SensorControls,
    thermostat: ThermostatControls,
    button: ButtonControls,
};

export default TYPE_CONTROLS;