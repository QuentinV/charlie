import React from 'react';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import AirIcon from '@mui/icons-material/Air';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DeviceThermostatIcon from '@mui/icons-material/DeviceThermostat';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import WifiIcon from '@mui/icons-material/Wifi';
import { alpha } from '@mui/material/styles';
import { updateState } from '../utils';
import { GOLD, GOLD_LIGHT, GOLD_DARK, AMBER, SURFACE, glow } from './climStyles';

const MIN_TEMP = 16;
const MAX_TEMP = 30;
const STEP = 0.5;

const MODES = [
    {
        value: 'heat',
        label: 'Chaud',
        icon: WbSunnyIcon,
        color: AMBER,
    },
    {
        value: 'cool',
        label: 'Froid',
        icon: AcUnitIcon,
        color: '#4EC8F5',
    },
    {
        value: 'dry',
        label: 'Déshumi.',
        icon: WaterDropIcon,
        color: '#4CD964',
    },
    {
        value: 'fan',
        label: 'Ventil.',
        icon: AirIcon,
        color: '#58C7B8',
    },
    {
        value: 'auto',
        label: 'Auto',
        icon: AutoAwesomeIcon,
        color: GOLD,
    },
];

const FAN_SPEEDS = [
    { value: 'auto', label: 'Auto' },
    { value: 'low', label: 'Faible' },
    { value: 'medium', label: 'Moyenne' },
    { value: 'high', label: 'Élevée' },
    { value: 'veryHigh', label: 'T. élevée' },
    { value: 'max', label: 'Max' },
];

const TELEMETRY = [
    {
        key: 'roomTemperature',
        label: 'Ambiante',
        unit: '°C',
        icon: DeviceThermostatIcon,
        color: GOLD,
    },
    {
        key: 'outdoorTemperature',
        label: 'Extérieur',
        unit: '°C',
        icon: WbSunnyIcon,
        color: AMBER,
    },
    {
        key: 'currentEnergyConsumed',
        label: 'Conso.',
        unit: 'kWh',
        icon: FlashOnIcon,
        color: '#4EC8F5',
    },
    {
        key: 'wifiSignalStrength',
        label: 'WiFi',
        unit: '%',
        icon: WifiIcon,
        color: '#4CD964',
    },
];

const MODE_META = (value) => MODES.find((m) => m.value === value) ?? MODES[4];

const roundNice = (value) =>
    Number.isFinite(value) ? Number(value.toFixed(2)) : value;

const format = (value, unit = '') =>
    value !== undefined && value !== null
        ? `${roundNice(Number(value))} ${unit}`.trim()
        : '-';

// ─── Small shared sx fragments ──────────────────────────────────

const chipBase = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0.5,
    minWidth: 0,
    flex: 1,
    px: 0.5,
    py: 1,
    borderRadius: 2,
    border: '1px solid transparent',
    transition:
        'background-color .18s ease, color .18s ease, border-color .18s ease, box-shadow .18s ease',
    cursor: 'pointer',
    '&:hover': {
        backgroundColor: 'rgba(255,215,0,0.08)',
    },
    '&.Mui-disabled': {
        opacity: 0.3,
        cursor: 'not-allowed',
    },
};

const activeChip = (color) => ({
    backgroundColor: alpha(color, 0.18),
    borderColor: alpha(color, 0.55),
    boxShadow: `0 0 0 1px ${alpha(color, 0.18)}, 0 4px 18px -6px ${alpha(color, 0.5)}`,
});
const SECTION_LABEL = {
    mb: 1,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: 'text.secondary',
    fontWeight: 600,
};

/**
 * Premium Mitsubishi AC (clim) control panel.
 * Maps directly to the `clim_mitshubishi` provider `properties` shape:
 *   power, targetTemperature, operationMode, fanSpeed + telemetry.
 * Uses `updateState` so the orchestrator contract stays unchanged.
 */
export const ACControls = ({ device, onStateChange }) => {
    const state = device?.state ?? {};
    const props = state?.properties ?? {};
    const power = state?.power === 'on';
    const targetTemperature = props?.targetTemperature ?? 21;
    const operationMode = props?.operationMode ?? 'auto';
    const fanSpeed = props?.fanSpeed ?? 'auto';
    const mode = MODE_META(operationMode);
    const ModeIcon = mode.icon;

    const setProperty = (key, value) =>
        updateState(
            device,
            { properties: { ...props, [key]: value } },
            onStateChange
        );
    const setPower = (on) =>
        updateState(device, { power: on ? 'on' : 'off' }, onStateChange);

    const adjustTemp = (dir) => {
        const next = Math.min(
            MAX_TEMP,
            Math.max(MIN_TEMP, targetTemperature + dir * STEP)
        );
        if (next !== targetTemperature) setProperty('targetTemperature', next);
    };

    const ringColor = power ? mode.color : 'rgba(255,255,255,0.18)';
    const dim = !power;

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
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography
                            sx={{
                                fontSize: 11,
                                color: 'text.secondary',
                                textTransform: 'capitalize',
                            }}
                        >
                            {mode.label}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>
                            • Mitsubishi
                        </Typography>
                    </Box>
                </Box>

                {/* Round power button */}
                <ButtonBase
                    aria-label={
                        power ? 'Éteindre le climatiseur' : 'Allumer le climatiseur'
                    }
                    onClick={() => setPower(!power)}
                    sx={{
                        width: 46,
                        height: 46,
                        borderRadius: '50%',
                        color: power ? GOLD_DARK : 'rgba(245,245,220,0.55)',
                        backgroundColor: power
                            ? `linear-gradient(135deg, ${GOLD_LIGHT} 0%, ${GOLD} 50%, ${GOLD_DARK} 100%)`
                            : 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,215,0,0.25)',
                        boxShadow: power ? glow(GOLD, 0.4) : 'none',
                        '&:hover': {
                            backgroundColor: power
                                ? `linear-gradient(135deg, ${GOLD} 0%, ${GOLD} 60%, ${GOLD_DARK} 100%)`
                                : 'rgba(255,255,255,0.12)',
                        },
                    }}
                >
                    <PowerSettingsNewIcon fontSize="small" />
                </ButtonBase>
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
                    <Stack alignItems="center" spacing={0.5} sx={{ textAlign: 'center' }}>
                        <Box sx={{ color: mode.color, opacity: dim ? 0.4 : 1 }}>
                            <ModeIcon fontSize="medium" />
                        </Box>
                        <Typography
                            sx={{
                                fontSize: 34,
                                lineHeight: 1,
                                fontWeight: 700,
                                letterSpacing: '-0.02em',
                                color: dim ? 'rgba(245,245,220,0.45)' : '#F5F5DC',
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
                            sx={{ fontSize: 11, color: 'text.secondary', mt: 0.25 }}
                        >
                            {power
                                ? `Pièce ${format(props.roomTemperature, '°')}`
                                : 'Éteint'}
                        </Typography>
                    </Stack>
                </Box>
            </Stack>
{/* ── Temperature stepper ─────────────────────── */}
            <Stack
                direction="row"
                alignItems="center"
                justifyContent="center"
                spacing={3}
                sx={{ py: 1 }}
            >
                <ButtonBase
                    aria-label="Baisser la température"
                    disabled={!power || targetTemperature <= MIN_TEMP}
                    onClick={() => adjustTemp(-1)}
                    sx={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        color: GOLD_DARK,
                        backgroundColor: `linear-gradient(135deg, ${alpha(GOLD, 0.16)}, ${alpha(GOLD, 0.05)})`,
                        border: '1px solid rgba(255,215,0,0.3)',
                        '&.Mui-disabled': {
                            color: 'rgba(245,245,220,0.2)',
                            borderColor: 'rgba(245,245,220,0.08)',
                            cursor: 'not-allowed',
                        },
                        '&:hover:not(.Mui-disabled)': {
                            backgroundColor: `linear-gradient(135deg, ${alpha(GOLD, 0.28)}, ${alpha(GOLD, 0.08)})`,
                            boxShadow: glow(GOLD, 0.3),
                        },
                    }}
                >
                    <RemoveIcon fontSize="small" />
                </ButtonBase>

                <Box sx={{ textAlign: 'center', width: 70 }}>
                    <Typography
                        sx={{
                            fontSize: 22,
                            fontWeight: 700,
                            color: dim ? 'rgba(245,245,220,0.45)' : '#F5F5DC',
                        }}
                    >
                        {targetTemperature}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                        °C — cible
                    </Typography>
                </Box>

                <ButtonBase
                    aria-label="Augmenter la température"
                    disabled={!power || targetTemperature >= MAX_TEMP}
                    onClick={() => adjustTemp(1)}
                    sx={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        color: GOLD_DARK,
                        backgroundColor: `linear-gradient(135deg, ${alpha(GOLD, 0.16)}, ${alpha(GOLD, 0.05)})`,
                        border: '1px solid rgba(255,215,0,0.3)',
                        '&.Mui-disabled': {
                            color: 'rgba(245,245,220,0.2)',
                            borderColor: 'rgba(245,245,220,0.08)',
                            cursor: 'not-allowed',
                        },
                        '&:hover:not(.Mui-disabled)': {
                            backgroundColor: `linear-gradient(135deg, ${alpha(GOLD, 0.28)}, ${alpha(GOLD, 0.08)})`,
                            boxShadow: glow(GOLD, 0.3),
                        },
                    }}
                >
                    <AddIcon fontSize="small" />
                </ButtonBase>
            </Stack>

            {/* ── Mode selector ───────────────────────────── */}
            <Box sx={{ mt: 1 }}>
                <Typography sx={SECTION_LABEL}>Mode</Typography>
                <Stack direction="row" spacing={0.75}>
                    {MODES.map((m) => {
                        const Icon = m.icon;
                        const isActive = power && operationMode === m.value;
                        return (
                            <ButtonBase
                                key={m.value}
                                aria-pressed={isActive}
                                disabled={!power}
                                onClick={() => setProperty('operationMode', m.value)}
                                sx={{
                                    ...chipBase,
                                    color: isActive ? m.color : 'rgba(245,245,220,0.55)',
                                    ...(isActive ? activeChip(m.color) : {}),
                                }}
                            >
                                <Icon fontSize="small" />
                                <Typography sx={{ fontSize: 10, lineHeight: 1.1 }}>
                                    {m.label}
                                </Typography>
                            </ButtonBase>
                        );
                    })}
                </Stack>
            </Box>

            {/* ── Fan speed selector ───────────────────────── */}
            <Box sx={{ mt: 1.5 }}>
                <Typography sx={SECTION_LABEL}>Ventilation</Typography>
                <Stack direction="row" spacing={0.75}>
                    {FAN_SPEEDS.map((s) => {
                        const isActive = power && fanSpeed === s.value;
                        return (
                            <ButtonBase
                                key={s.value}
                                aria-pressed={isActive}
                                disabled={!power}
                                onClick={() => setProperty('fanSpeed', s.value)}
                                sx={{
                                    ...chipBase,
                                    borderRadius: '999px',
                                    color: isActive ? GOLD : 'rgba(245,245,220,0.6)',
                                    ...(isActive ? activeChip(GOLD) : {}),
                                }}
                            >
                                <Typography sx={{ fontSize: 10, lineHeight: 1.1 }}>
                                    {s.label}
                                </Typography>
                            </ButtonBase>
                        );
                    })}
                </Stack>
            </Box>

            {/* ── Telemetry tiles ──────────────────────────── */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 1.25,
                    mt: 2,
                }}
            >
                {TELEMETRY.map((t) => {
                    const Icon = t.icon;
                    const value = props?.[t.key];
                    const isWifi = t.key === 'wifiSignalStrength';
                    return (
                        <Box
                            key={t.key}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1.25,
                                p: 1.25,
                                borderRadius: 2,
                                background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0))',
                                bgcolor: 'rgba(3,3,4,0.25)',
                                border: '1px solid rgba(255,255,255,0.06)',
                            }}
                        >
                            <Box
                                sx={{
                                    width: 34,
                                    height: 34,
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: t.color,
                                    backgroundColor: alpha(t.color, 0.14),
                                    flexShrink: 0,
                                }}
                            >
                                <Icon fontSize="small" />
                            </Box>
                            <Box sx={{ minWidth: 0 }}>
                                <Typography sx={{ fontSize: 10, color: 'text.secondary', letterSpacing: 0.5 }}>
                                    {t.label}
                                </Typography>
                                <Typography sx={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>
                                    {format(value, t.unit)}
                                </Typography>
                            </Box>
                            {isWifi && (
                                <Box
                                    sx={{
                                        ml: 'auto',
                                        display: 'flex',
                                        alignItems: 'flex-end',
                                        gap: 0.25,
                                        color: value > 60 ? '#4CD964' : value > 30 ? AMBER : '#FF5D5D',
                                    }}
                                >
                                    {[1, 2, 3].map((bar) => (
                                        <Box
                                            key={bar}
                                            sx={{
                                                width: 4,
                                                height: 5 + bar * 3,
                                                borderRadius: 1,
                                                backgroundColor: 'currentColor',
                                                opacity: value >= bar * 30 ? 1 : 0.25,
                                            }}
                                        />
                                    ))}
                                </Box>
                            )}
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
};

// This control already exposes all its declared functions directly in the
// panel (operation mode, fan speed, target temperature) — suppress the
// external "Fonctions" section rendered by DeviceDetailControls.
ACControls.HIDES_FUNCTIONS = true;

export default ACControls;