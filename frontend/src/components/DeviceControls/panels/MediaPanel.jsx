import React, { useRef, useState } from 'react';
import { Box, ButtonBase, Stack, TextField, Typography } from '@mui/material';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import SendIcon from '@mui/icons-material/Send';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import TvIcon from '@mui/icons-material/Tv';
import MovieIcon from '@mui/icons-material/Movie';
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary';
import SettingsInputHdmiIcon from '@mui/icons-material/SettingsInputHdmi';
import LiveTvIcon from '@mui/icons-material/LiveTv';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import StopIcon from '@mui/icons-material/Stop';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import { alpha } from '@mui/material/styles';
import { updateState, callDeviceFunction } from '../utils';
import {
    GOLD,
    GOLD_LIGHT,
    GOLD_DARK,
    SURFACE,
    glow,
} from '../primitives/tokens';

/** Transport services in display order. */
const TRANSPORT = [
    { name: 'media_player.media_previous_track', icon: SkipPreviousIcon },
    { name: 'media_player.media_play', icon: PlayArrowIcon },
    { name: 'media_player.media_pause', icon: PauseIcon },
    { name: 'media_player.media_next_track', icon: SkipNextIcon },
    { name: 'media_player.media_stop', icon: StopIcon },
];

const sourceIcon = (title = '') => {
    const t = String(title).toLowerCase();
    if (t.includes('hdmi')) return SettingsInputHdmiIcon;
    if (t.includes('component') || t.includes('av1')) return MovieIcon;
    if (t.includes('video') || t.includes('applications'))
        return VideoLibraryIcon;
    if (t.includes('tuner') || t.includes('tv') || t.includes('cable'))
        return TvIcon;
    return LiveTvIcon;
};

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

const activeChip = (color = GOLD) => ({
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

const keyBase = {
    width: 56,
    height: 50,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0.25,
    borderRadius: 2,
    color: 'rgba(245,245,220,0.75)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,215,0,0.12)',
    transition:
        'background-color .18s ease, color .18s ease, border-color .18s ease, box-shadow .18s ease',
    '&:hover': {
        backgroundColor: 'rgba(255,215,0,0.14)',
        color: GOLD_LIGHT,
    },
    '&.Mui-disabled': {
        opacity: 0.3,
        cursor: 'not-allowed',
    },
};

const roundButton = {
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
};

/**
 * Media panel (TVs, and any `media_player`-backed device).
 *
 * Everything is read from the standard device contract, so one panel serves
 * every TV whatever its gateway:
 *  - `state.power` / `state.level` (volume, 0..100) and the properties bag
 *    (`volume_level`, `is_volume_muted`, `source`, `app_name`, `media_title`),
 *  - the provider functions (`capabilities.functions[]`): the inputs are
 *    `media_player.select_source`'s `source` options (HA `source_list`), the
 *    transport keys exist only when the matching `media_player.media_*`
 *    service is advertised, and `remote.send_command` renders the field its
 *    gateway declares — free text, since no gateway publishes key names.
 */
export const MediaPanel = ({
    device,
    capabilities,
    onStateChange,
    title = 'Téléviseur',
}) => {
    const state = device?.state ?? {};
    const props = state?.properties ?? {};
    const power = state?.power === 'on';
    const dim = !power;

    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [command, setCommand] = useState('');
    const [optimisticVolume, setOptimisticVolume] = useState(null);
    const volumeTimer = useRef(null);

    const functions = capabilities?.functions ?? [];
    const find = (name) => functions.find((f) => f.name === name);
    const optionsOf = (name, key) =>
        find(name)?.inputSchema?.find((field) => field.key === key)?.options ??
        [];

    /** The gateway's own command field — no vocabulary of ours. */
    const commandField = find('remote.send_command')?.inputSchema?.find(
        (field) => field.key === 'command'
    );

    const sources = optionsOf('media_player.select_source', 'source').length
        ? optionsOf('media_player.select_source', 'source')
        : (props.source_list ?? []).map((value) => ({ value, label: value }));

    const volume = Math.round(
        Number(
            optimisticVolume ??
                state?.level ??
                (props.volume_level != null
                    ? Number(props.volume_level) * 100
                    : 0)
        ) || 0
    );
    const muted = props.is_volume_muted === true;
    const nowTitle = props.app_name ?? props.media_title ?? '';
    const nowDetail = props.app_name ? props.media_title : props.source;
    const NowIcon = props.media_title ? VideoLibraryIcon : TvIcon;
    const canMute = !!find('media_player.volume_mute');

    const setPower = (on) =>
        updateState(device, { power: on ? 'on' : 'off' }, onStateChange);

    /**
     * Debounced absolute write — only for gateways that report a level
     * (`level` → `media_player.volume_set`).
     */
    const setVolume = (value) => {
        const next = Math.min(100, Math.max(0, value));
        setOptimisticVolume(next);
        clearTimeout(volumeTimer.current);
        volumeTimer.current = setTimeout(() => {
            updateState(device, { level: next }, (nextState) => {
                setOptimisticVolume(null);
                onStateChange?.(nextState);
            }).catch(() => setOptimisticVolume(null));
        }, 500);
    };

    const run = async (label, action) => {
        setBusy(label);
        setError('');
        try {
            await action();
        } catch (e) {
            setError(e?.message ?? 'Commande impossible');
        } finally {
            setBusy('');
        }
    };

    const setMute = (value) =>
        run('mute', () =>
            callDeviceFunction(device?._id, 'media_player.volume_mute', {
                is_volume_muted: value,
            })
        );

    /** Free-text command: HA declares the field, the user types the key. */
    const sendCommand = () => {
        const value = command.trim();
        if (!value) return;
        run('command', async () => {
            await callDeviceFunction(device?._id, 'remote.send_command', {
                command: value,
            });
            setCommand('');
        });
    };

    /** One gateway step — the only volume control without an absolute level. */
    const stepVolume = (direction) =>
        run('volume', () =>
            callDeviceFunction(
                device?._id,
                direction > 0
                    ? 'media_player.volume_up'
                    : 'media_player.volume_down'
            )
        );

    const selectSource = (source) =>
        run(source, () =>
            callDeviceFunction(device?._id, 'media_player.select_source', {
                source,
            })
        );

    const transport = TRANSPORT.filter((service) => !!find(service.name));

    // Absolute volume when the gateway reports one; otherwise the honest
    // control is the step service (a gateway without UPnP/DMR ignores a level).
    const hasLevel = state?.level != null || props.volume_level != null;
    const stepOnly =
        !hasLevel &&
        !!(find('media_player.volume_up') || find('media_player.volume_down'));

    // The entity's own HA domain (`media_player`, `remote`…) — gateway
    // vocabulary, never a brand or an integration name.
    const entityDomain = String(device?.externalId ?? '').split('.')[0];

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
                        ? `radial-gradient(circle, ${alpha(GOLD, 0.14)}, transparent 70%)`
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
                        {title}
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
                            {power ? 'Allumé' : 'Éteint'}
                        </Typography>
                        {entityDomain ? (
                            <Typography
                                sx={{ fontSize: 11, color: 'text.disabled' }}
                            >
                                • {entityDomain}
                            </Typography>
                        ) : null}
                    </Box>
                </Box>

                <ButtonBase
                    aria-label={
                        power
                            ? `Éteindre ${title.toLowerCase()}`
                            : `Allumer ${title.toLowerCase()}`
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
                        transition: 'all .2s ease',
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

            {/* ── Now playing ─────────────────────────────── */}
            {nowTitle ? (
                <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{ mt: 1.5, position: 'relative' }}
                >
                    <NowIcon
                        fontSize="small"
                        sx={{ color: dim ? 'text.disabled' : GOLD }}
                    />
                    <Box sx={{ minWidth: 0 }}>
                        <Typography
                            sx={{
                                fontSize: 13,
                                lineHeight: 1.2,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                color: dim
                                    ? 'rgba(245,245,220,0.45)'
                                    : '#F5F5DC',
                            }}
                        >
                            {nowTitle}
                        </Typography>
                        {nowDetail ? (
                            <Typography
                                sx={{ fontSize: 11, color: 'text.secondary' }}
                            >
                                {nowDetail}
                            </Typography>
                        ) : null}
                    </Box>
                </Stack>
            ) : null}

            {/* ── Volume + mute ───────────────────────────── */}
            <Box sx={{ mt: 2 }}>
                <Typography sx={SECTION_LABEL}>Volume</Typography>
                <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="center"
                    spacing={3}
                >
                    <ButtonBase
                        aria-label="Baisser le volume"
                        disabled={!power || (!stepOnly && volume <= 0)}
                        onClick={() =>
                            stepOnly ? stepVolume(-1) : setVolume(volume - 1)
                        }
                        sx={roundButton}
                    >
                        <RemoveIcon fontSize="small" />
                    </ButtonBase>

                    <Box sx={{ textAlign: 'center', width: 70 }}>
                        <Typography
                            sx={{
                                fontSize: 26,
                                fontWeight: 700,
                                lineHeight: 1.1,
                                color: dim
                                    ? 'rgba(245,245,220,0.45)'
                                    : '#F5F5DC',
                            }}
                        >
                            {muted ? 'Muet' : stepOnly ? '±' : volume}
                        </Typography>
                        <Typography
                            sx={{ fontSize: 11, color: 'text.secondary' }}
                        >
                            {stepOnly ? 'pas à pas' : '/ 100'}
                        </Typography>
                    </Box>

                    <ButtonBase
                        aria-label="Augmenter le volume"
                        disabled={!power || (!stepOnly && volume >= 100)}
                        onClick={() =>
                            stepOnly ? stepVolume(1) : setVolume(volume + 1)
                        }
                        sx={roundButton}
                    >
                        <AddIcon fontSize="small" />
                    </ButtonBase>
                </Stack>

                {canMute ? (
                    <Stack
                        direction="row"
                        alignItems="center"
                        justifyContent="center"
                        spacing={1}
                        sx={{ mt: 1 }}
                    >
                        <ButtonBase
                            aria-label={
                                muted ? 'Activer le son' : 'Couper le son'
                            }
                            disabled={!power}
                            onClick={() => setMute(!muted)}
                            sx={{
                                ...chipBase,
                                flex: 'none',
                                minWidth: 90,
                                flexDirection: 'row',
                                color: muted ? '#FF5D5D' : GOLD,
                                ...(muted
                                    ? activeChip('#FF5D5D')
                                    : activeChip()),
                            }}
                        >
                            {muted ? (
                                <VolumeOffIcon fontSize="small" />
                            ) : (
                                <VolumeUpIcon fontSize="small" />
                            )}
                            <Typography sx={{ fontSize: 12, lineHeight: 1.2 }}>
                                {muted ? 'Muet' : 'Son'}
                            </Typography>
                        </ButtonBase>
                    </Stack>
                ) : null}
            </Box>

            {/* ── Sources ─────────────────────────────────── */}
            {sources.length > 0 ? (
                <Box sx={{ mt: 2 }}>
                    <Typography sx={SECTION_LABEL}>Entrées</Typography>
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns:
                                'repeat(auto-fill, minmax(96px, 1fr))',
                            gap: 0.75,
                        }}
                    >
                        {sources.map((source) => {
                            const Icon = sourceIcon(source.label);
                            const isActive = props.source === source.value;
                            return (
                                <ButtonBase
                                    key={source.value}
                                    aria-pressed={isActive}
                                    disabled={!power || busy === source.value}
                                    onClick={() => selectSource(source.value)}
                                    sx={{
                                        ...chipBase,
                                        color: isActive
                                            ? GOLD
                                            : 'rgba(245,245,220,0.6)',
                                        ...(isActive ? activeChip() : {}),
                                    }}
                                >
                                    <Icon fontSize="small" />
                                    <Typography
                                        sx={{
                                            fontSize: 10,
                                            lineHeight: 1.1,
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            maxWidth: '100%',
                                        }}
                                    >
                                        {source.label}
                                    </Typography>
                                </ButtonBase>
                            );
                        })}
                    </Box>
                </Box>
            ) : null}

            {/* ── Transport ───────────────────────────────── */}
            {transport.length > 0 ? (
                <Box sx={{ mt: 2 }}>
                    <Typography sx={SECTION_LABEL}>Lecture</Typography>
                    <Stack direction="row" justifyContent="center" spacing={1}>
                        {transport.map((service) => {
                            const TransportIcon = service.icon;
                            return (
                                <ButtonBase
                                    key={service.name}
                                    aria-label={service.name.split('.')[1]}
                                    disabled={!power || busy === service.name}
                                    onClick={() =>
                                        run(service.name, () =>
                                            callDeviceFunction(
                                                device?._id,
                                                service.name
                                            )
                                        )
                                    }
                                    sx={keyBase}
                                >
                                    <TransportIcon fontSize="small" />
                                </ButtonBase>
                            );
                        })}
                    </Stack>
                </Box>
            ) : null}

            {commandField ? (
                <Box sx={{ mt: 2 }}>
                    <Typography sx={SECTION_LABEL}>Commande</Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                        <TextField
                            size="small"
                            fullWidth
                            value={command}
                            placeholder={commandField.label}
                            onChange={(event) => setCommand(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') sendCommand();
                            }}
                            disabled={!power || !!busy}
                            sx={{ '& .MuiInputBase-root': { fontSize: 14 } }}
                        />
                        <ButtonBase
                            aria-label="Envoyer la commande"
                            disabled={!power || !!busy || !command.trim()}
                            onClick={sendCommand}
                            sx={{ ...keyBase, width: 56, height: 40 }}
                        >
                            <SendIcon fontSize="small" />
                        </ButtonBase>
                    </Stack>
                </Box>
            ) : null}

            {error ? (
                <Typography
                    variant="caption"
                    sx={{ display: 'block', mt: 1.5, color: '#FF5D5D' }}
                >
                    {error}
                </Typography>
            ) : null}
        </Box>
    );
};

export default MediaPanel;
