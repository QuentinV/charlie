import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { updateState } from '../utils';
import { TypePanel } from '../types/typeShell';
import {
    GOLD,
    GOLD_LIGHT,
    SURFACE,
    SECTION_LABEL,
    TYPE_COLORS,
    glow,
} from '../types/typeStyles';
import { PowerButton } from '../primitives/PowerButton';
import { Stepper } from '../primitives/Stepper';
import { ChipRow } from '../primitives/ChipRow';
import { TileGrid } from '../primitives/TileGrid';
import { climatePresentation } from '../presentation/climate';

/**
 * The climate panel — one implementation for every climate-ish device.
 *
 * `variant` selects the shell only:
 *  - `clim` (control profile advertised by the provider): premium glossy card
 *    with hero dial, animated accents, chip selectors and telemetry tiles;
 *  - `default` (per-type fallback): the compact `TypePanel` shell.
 *
 * Everything else — ranges, mode/fan option lists, labels, telemetry — comes
 * from `climatePresentation` (backed by `capabilities.state`), and every
 * interaction goes through `updateState`. Adding a provider/integration is
 * therefore a data change, never a new panel.
 */
export const ClimatePanel = ({
    device,
    onStateChange,
    capabilities,
    variant = 'default',
}) => {
    const premium = variant === 'clim';

    const state = device?.state ?? {};
    const props = state?.properties ?? {};

    const power = state?.power === 'on';

    const view = climatePresentation({
        schema: capabilities?.state,
        props,
    });

    // Everything is capability-driven: the panel never hardcodes a property key
    // (canonical keys are the gateway's own, e.g. HA `temperature`/`hvac_mode`).
    const targetTemperature = view.temperature;
    const operationMode = view.modeValue;
    const fanSpeed = view.fanValue;

    const mode = view.mode;
    const ModeIcon = mode.icon;
    // Telemetry is already formatted by `climatePresentation`; the dial shows
    // the ambient temperature when the device reports it.
    const roomTemperature = view.telemetry.find(
        (tile) => tile.key === 'current_temperature'
    )?.value;

    const ringColor = power ? mode.color : 'rgba(255,255,255,0.18)';
    const dim = !power;

    /** Write a capability property (no-op when the device exposes none). */
    const setProperty = (key, value) =>
        key
            ? updateState(
                  device,
                  { properties: { ...props, [key]: value } },
                  onStateChange
              )
            : undefined;
    const setPower = (on) =>
        updateState(device, { power: on ? 'on' : 'off' }, onStateChange);

    /**
     * An optional enum selector row (ventilation, swing orientations...):
     * rendered only when the device's own capabilities advertise the property,
     * so a new integration adds rows through data, never through code.
     */
    const optionRow = (label, key, options, value) =>
        key && options?.length > 0 ? (
            <Box sx={{ mt: 1.5 }} key={key}>
                <Typography sx={SECTION_LABEL}>{label}</Typography>
                <ChipRow
                    variant="pill"
                    options={options}
                    value={value}
                    active={power}
                    inactiveColor="rgba(245,245,220,0.6)"
                    onChange={(next) => setProperty(key, next)}
                />
            </Box>
        ) : null;

    const stepper = (
        <Stepper
            variant={premium ? 'gradient' : 'plain'}
            value={targetTemperature}
            min={view.minTemp}
            max={view.maxTemp}
            step={view.step}
            disabled={!power}
            dimmed={dim}
            disableAtBounds={premium}
            color={TYPE_COLORS.thermostat}
            spacing={premium ? 3 : 2}
            slotSx={premium ? { width: 70 } : { my: 0.5 }}
            display={premium ? targetTemperature : `${targetTemperature}°C`}
            caption={premium ? '°C — cible' : 'Consigne'}
            ariaLabels={{
                decrease: premium
                    ? 'Baisser la température'
                    : 'Diminuer la température',
                increase: premium
                    ? 'Augmenter la température'
                    : 'Augmenter la température',
            }}
            onChange={(next) => setProperty(view.temperatureKey, next)}
        />
    );

    if (!premium) {
        return (
            <TypePanel
                type="thermostat"
                title="Thermostat"
                power={power}
                onTogglePower={setPower}
            >
                <Typography sx={SECTION_LABEL}>Température cible</Typography>
                {stepper}

                {view.modeOptions.length > 1 ? (
                    <Box sx={{ mt: 1 }}>
                        <Typography sx={SECTION_LABEL}>Mode</Typography>
                        <ChipRow
                            options={view.modeOptions}
                            value={operationMode}
                            active={power}
                            onChange={(value) =>
                                setProperty(view.modeKey, value)
                            }
                        />
                    </Box>
                ) : (
                    /* No schema options (e.g. a native provider): keep the
                       read-only mode readout instead of an empty selector. */
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            px: 1,
                            py: 0.75,
                            borderRadius: 1,
                            bgcolor: 'rgba(255,255,255,0.03)',
                        }}
                    >
                        <Typography variant="body2" color="text.secondary">
                            Mode
                        </Typography>
                        <Typography
                            variant="subtitle1"
                            sx={{
                                fontWeight: 700,
                                color: TYPE_COLORS.thermostat,
                            }}
                        >
                            {mode.label}
                        </Typography>
                    </Box>
                )}
            </TypePanel>
        );
    }

    return (
        <Box
            className="no-select"
            sx={{
                position: 'relative',
                overflow: 'hidden',
                borderRadius: '20px',
                p: 2,
                background:
                    'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 60%)',
                bgcolor: SURFACE,
                border: '1px solid rgba(255,215,0,0.14)',
                boxShadow: power ? glow(GOLD_LIGHT) : glow('#000', 0.35),
                transition: 'box-shadow .35s ease, border-color .35s ease',
            }}
        >
            {/* subtle top accent glow */}
            <Box
                sx={{
                    position: 'absolute',
                    top: -70,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 260,
                    height: 140,
                    borderRadius: '50%',
                    background: power
                        ? `radial-gradient(circle, ${alpha(GOLD, 0.16)}, transparent 70%)`
                        : 'transparent',
                    transition: 'background .4s ease',
                    pointerEvents: 'none',
                }}
            />

            {/* ── Header ───────────────────────────────────── */}
            <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ position: 'relative' }}
            >
                <Box>
                    <Typography
                        sx={{
                            fontSize: 13,
                            letterSpacing: 2,
                            textTransform: 'uppercase',
                            color: alpha(GOLD_LIGHT, 0.75),
                            fontWeight: 700,
                        }}
                    >
                        Climatiseur
                    </Typography>
                    <Box
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                    >
                        <Typography
                            sx={{
                                fontSize: 11,
                                color: 'text.secondary',
                                textTransform: 'capitalize',
                            }}
                        >
                            {mode.label}
                        </Typography>
                    </Box>
                </Box>

                <PowerButton
                    variant="gradient"
                    power={power}
                    onToggle={setPower}
                    ariaLabel={
                        power
                            ? 'Éteindre le climatiseur'
                            : 'Allumer le climatiseur'
                    }
                />
            </Stack>

            {/* ── Hero dial ─────────────────────────────── */}
            <Stack
                alignItems="center"
                justifyContent="center"
                sx={{ position: 'relative', py: 1, my: 2 }}
            >
                <Box
                    sx={{
                        position: 'relative',
                        width: 150,
                        height: 150,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: alpha(ringColor, 0.08),
                        border: `1px solid ${alpha(ringColor, 0.4)}`,
                        boxShadow: power
                            ? `0 0 0 6px ${alpha(ringColor, 0.12)}, 0 0 32px -6px ${alpha(ringColor, 0.4)}`
                            : 'none',
                        transition: 'all .35s ease',
                    }}
                >
                    <Stack
                        alignItems="center"
                        spacing={0.5}
                        sx={{ textAlign: 'center' }}
                    >
                        <Box sx={{ color: mode.color, opacity: dim ? 0.4 : 1 }}>
                            <ModeIcon fontSize="medium" />
                        </Box>
                        <Typography
                            sx={{
                                fontSize: 34,
                                lineHeight: 1,
                                fontWeight: 700,
                                letterSpacing: '-0.02em',
                                color: dim
                                    ? 'rgba(245,245,220,0.45)'
                                    : '#F5F5DC',
                            }}
                        >
                            {targetTemperature}
                            <Box
                                component="span"
                                sx={{
                                    display: 'inline-block',
                                    fontSize: 14,
                                    color: 'text.secondary',
                                    verticalAlign: 'super',
                                    ml: 0.5,
                                }}
                            >
                                °C
                            </Box>
                        </Typography>
                        <Typography
                            sx={{
                                fontSize: 11,
                                color: 'text.secondary',
                                mt: 0.25,
                            }}
                        >
                            {power
                                ? `Pièce ${roomTemperature ?? '-'}`
                                : 'Éteint'}
                        </Typography>
                    </Stack>
                </Box>
            </Stack>

            {/* ── Temperature stepper ─────────────────────── */}
            {stepper}

            {/* ── Mode selector ───────────────────────────── */}
            {view.modeOptions.length > 0 && (
                <Box sx={{ mt: 1 }}>
                    <Typography sx={SECTION_LABEL}>Mode</Typography>
                    <ChipRow
                        options={view.modeOptions}
                        value={operationMode}
                        active={power}
                        onChange={(value) => setProperty(view.modeKey, value)}
                    />
                </Box>
            )}

            {/* ── Ventilation + orientation selectors ───────────────────────── */}
            {optionRow(
                'Ventilation',
                view.fanKey,
                view.fanSpeedOptions,
                fanSpeed
            )}
            {optionRow(
                'Orientation',
                view.swingKey,
                view.swingOptions,
                view.swingValue
            )}
            {optionRow(
                'Orientation horiz.',
                view.swingHorizontalKey,
                view.swingHorizontalOptions,
                view.swingHorizontalValue
            )}

            {/* ── Telemetry tiles ──────────────────────────── */}
            <TileGrid tiles={view.telemetry} sx={{ mt: 2 }} />
        </Box>
    );
};

export default ClimatePanel;
