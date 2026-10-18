import React from 'react';
import { Box, ButtonBase, LinearProgress, Typography } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import StopIcon from '@mui/icons-material/Stop';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { alpha } from '@mui/material/styles';
import { TypePanel } from './typeShell';
import { callDeviceFunction, updateState } from '../utils';
import { SECTION_LABEL, TYPE_COLORS } from './typeStyles';

/**
 * Default `shutter` control panel: open / stop / close buttons + position
 * readout (level, 0=closed → 100=open).
 *
 * Open/close go through `DeviceState.power` (the provider maps it to HA's
 * `open_cover` / `close_cover` and returns a write-through state, so the panel
 * updates immediately). Stop uses the advertised `cover.stop_cover` service —
 * the only real "stop"; re-asserting a position does not halt a moving cover.
 * `level` only renders when the gateway proves it (`SET_POSITION` or a reported
 * position).
 */
export const ShutterControls = ({ device, onStateChange, capabilities }) => {
    const state = device?.state ?? {};
    const power = state?.power === 'on';
    const position = state?.level ?? (power ? 100 : 0);

    const functions = capabilities?.functions ?? [];
    const hasStop = functions.some((fn) => fn.name === 'cover.stop_cover');
    const hasLevel = (capabilities?.state ?? []).some(
        (field) => field.key === 'level'
    );

    const open = () =>
        updateState(
            device,
            hasLevel ? { power: 'on', level: 100 } : { power: 'on' },
            onStateChange
        );
    const close = () =>
        updateState(
            device,
            hasLevel ? { power: 'off', level: 0 } : { power: 'off' },
            onStateChange
        );
    const stop = () =>
        hasStop
            ? callDeviceFunction(device?._id, 'cover.stop_cover')
            : hasLevel
              ? // Fallback for a gateway without the service: re-assert the
                // current position to halt any movement.
                updateState(device, { level: position }, onStateChange)
              : undefined;

    return (
        <TypePanel
            type="shutter"
            title="Volet roulant"
            power={power}
            onTogglePower={(on) => (on ? open() : close())}
        >
            {hasLevel && (
                <>
                    <Typography sx={SECTION_LABEL}>Position</Typography>

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
                            {position <= 5
                                ? 'Fermé'
                                : position >= 95
                                  ? 'Ouvert'
                                  : 'Partiellement ouvert'}
                        </Typography>
                        <Typography
                            variant="subtitle1"
                            sx={{ fontWeight: 700, color: TYPE_COLORS.shutter }}
                        >
                            {position}%
                        </Typography>
                    </Box>
                    <LinearProgress
                        variant="determinate"
                        value={position}
                        sx={{
                            height: 6,
                            borderRadius: 3,
                            color: TYPE_COLORS.shutter,
                        }}
                    />
                </>
            )}

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 0.75,
                    mt: 1.5,
                }}
            >
                <ButtonBase
                    onClick={open}
                    aria-label="Ouvrir"
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 0.5,
                        py: 1,
                        borderRadius: 2,
                        background: 'rgba(255,255,255,0.04)',
                        border: `1px solid ${alpha('#7BA7FE', 0.3)}`,
                        color: '#7BA7FE',
                        '&:hover': {
                            backgroundColor: 'rgba(123,167,254,0.12)',
                        },
                    }}
                >
                    <ArrowUpwardIcon fontSize="small" />
                    <Typography sx={{ fontSize: 10 }}>Ouvrir</Typography>
                </ButtonBase>
                <ButtonBase
                    onClick={stop}
                    aria-label="Arrêter"
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 0.5,
                        py: 1,
                        borderRadius: 2,
                        background: 'rgba(255,255,255,0.04)',
                        border: `1px solid ${alpha('#ffb300', 0.3)}`,
                        color: '#ffb300',
                        '&:hover': {
                            backgroundColor: 'rgba(255,179,0,0.12)',
                        },
                    }}
                >
                    <StopIcon fontSize="small" />
                    <Typography sx={{ fontSize: 10 }}>Arrêter</Typography>
                </ButtonBase>
                <ButtonBase
                    onClick={close}
                    aria-label="Fermer"
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 0.5,
                        py: 1,
                        borderRadius: 2,
                        background: 'rgba(255,255,255,0.04)',
                        border: `1px solid ${alpha('#7BA7FE', 0.3)}`,
                        color: '#7BA7FE',
                        '&:hover': {
                            backgroundColor: 'rgba(123,167,254,0.12)',
                        },
                    }}
                >
                    <ArrowDownwardIcon fontSize="small" />
                    <Typography sx={{ fontSize: 10 }}>Fermer</Typography>
                </ButtonBase>
            </Box>
        </TypePanel>
    );
};

export default ShutterControls;
