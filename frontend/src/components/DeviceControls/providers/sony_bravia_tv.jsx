import React, { useCallback, useEffect, useState } from 'react';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import SearchIcon from '@mui/icons-material/Search';
import HomeIcon from '@mui/icons-material/Home';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import CheckIcon from '@mui/icons-material/Check';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import TvIcon from '@mui/icons-material/Tv';
import MovieIcon from '@mui/icons-material/Movie';
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary';
import SettingsInputHdmiIcon from '@mui/icons-material/SettingsInputHdmi';
import LiveTvIcon from '@mui/icons-material/LiveTv';
import DevicesIcon from '@mui/icons-material/Devices';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SmartDisplayIcon from '@mui/icons-material/SmartDisplay';
import { alpha } from '@mui/material/styles';
import { api } from '../../../api/charlie';
import { updateState } from '../utils';
import {
    GOLD,
    GOLD_LIGHT,
    GOLD_DARK,
    AMBER,
    SURFACE,
    glow,
} from './climStyles';

const call = async (deviceId, name, params = undefined) =>
    api(`devices/${deviceId}/functions/${name}`, {
        method: 'POST',
        body: JSON.stringify(params ?? {}),
    });

const first = (value) => {
    if (Array.isArray(value)) return value[0];
    if (value?.result) {
        const r = value.result;
        if (Array.isArray(r)) return r[0];
        return r;
    }
    return value;
};

const D_PAD = [
    { key: 'Up', icon: ArrowUpwardIcon, label: 'Haut' },
    { key: 'Down', icon: ArrowDownwardIcon, label: 'Bas' },
    { key: 'Left', icon: ArrowLeftIcon, label: 'Gauche' },
    { key: 'Right', icon: ArrowRightIcon, label: 'Droite' },
    { key: 'Confirm', icon: CheckIcon, label: 'OK' },
];
const REMOTE_KEYS = [
    { key: 'Home', icon: HomeIcon, label: 'Accueil' },
    { key: 'Return', icon: ArrowBackIcon, label: 'Retour' },
    { key: 'Search', icon: SearchIcon, label: 'Recherche' },
    { key: 'Exit', icon: CloseIcon, label: 'Quitter' },
];

const QUICK_LAUNCH = [
    {
        key: 'Netflix',
        icon: MovieIcon,
        label: 'Netflix',
        appUri: 'com.sony.dtv.com.netflix.ninja.com.netflix.ninja.MainActivity',
    },
    {
        key: 'YouTube',
        icon: VideoLibraryIcon,
        label: 'YouTube',
        appUri: 'com.sony.dtv.com.google.android.youtube.tv.com.google.android.apps.youtube.tv.activity.ShellActivity',
    },
    {
        key: 'Jellyfin',
        icon: SmartDisplayIcon,
        label: 'Jellyfin',
        appUri: 'com.sony.dtv.org.jellyfin.androidtv.org.jellyfin.androidtv.ui.startup.StartupActivity',
    },
    {
        key: 'GooglePlay',
        icon: PlayArrowIcon,
        label: 'Google Play',
    },
    { key: 'Play', icon: PlayArrowIcon, label: 'Lecture' },
    { key: 'Pause', icon: PauseIcon, label: 'Pause' },
];

const sourceIcon = (title = '') => {
    const t = String(title).toLowerCase();
    if (t.includes('hdmi')) return SettingsInputHdmiIcon;
    if (t.includes('chromecast') || t.includes('google')) return DevicesIcon;
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

let timeoutDebounceVolume = null;

/**
 * Premium Sony Bravia TV control panel: power, now-playing, volume/mute,
 * inputs and a remote D-pad + quick-launch keys.
 */
export const TVControls = ({ device, onStateChange }) => {
    const power = device?.state?.power === 'on';
    const dim = !power;
    const [info, setInfo] = useState(null);
    const [content, setContent] = useState(null);
    const [sources, setSources] = useState([]);
    const [apps, setApps] = useState([]);
    const [app, setApp] = useState('');
    const [busy, setBusy] = useState(false);

    const refresh = useCallback(async () => {
        const [vol, playing, srcList, appList] = await Promise.allSettled([
            call(device?._id, 'getVolumeInformation'),
            call(device?._id, 'getPlayingContentInfo'),
            call(device?._id, 'getSourceList'),
            call(device?._id, 'getApplicationList'),
        ]);
        if (vol.status === 'fulfilled') setInfo(first(vol.value) ?? null);
        if (playing.status === 'fulfilled')
            setContent(first(playing.value) ?? null);
        if (srcList.status === 'fulfilled') {
            const rows = first(srcList.value);
            setSources(Array.isArray(rows) ? rows : []);
        }
        if (appList.status === 'fulfilled') {
            setApps(appList.value);
        }
    }, [device?._id]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const volume = info?.volume ?? 0;
    const mute = info?.mute === true;
    const maxVolume = info?.maxVolume ?? 100;

    const setPower = (on) =>
        updateState(device, { power: on ? 'on' : 'off' }, onStateChange);

    const setVolume = (value) => {
        clearTimeout(timeoutDebounceVolume);
        timeoutDebounceVolume = setTimeout(() => {
            call(device?._id, 'setAudioVolume', {
                target: 'speaker',
                volume: String(value),
            }).then(refresh);
        }, 500);
        setInfo({ ...(info ?? {}), volume: value });
    };

    const setMute = (value) =>
        call(device?._id, 'setAudioMute', { status: value }).then(refresh);

    const pressKey = async (key) => {
        setBusy(true);
        try {
            await call(device?._id, 'pressKey', { key });
        } finally {
            setBusy(false);
        }
    };

    const switchSource = (source) =>
        call(device?._id, 'setPlayContent', {
            uri: source.uri,
            title: source.title ?? '',
        });

    const launchApp = () => {
        const selected =
            apps.find((a) => (a.title ?? a.name) === app) ?? apps[0];
        if (selected) {
            call(device?._id, 'setActiveApp', {
                uri: selected.uri,
                data: selected.data ?? '',
            });
        }
    };

    const nowTitle =
        content?.title ?? content?.programTitle ?? 'Aucune lecture';
    const NowIcon = content ? VideoLibraryIcon : TvIcon;
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
                        Téléviseur
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
                        <Typography
                            sx={{ fontSize: 11, color: 'text.disabled' }}
                        >
                            • Sony Bravia
                        </Typography>
                    </Box>
                </Box>

                <ButtonBase
                    aria-label={
                        power
                            ? 'Éteindre le téléviseur'
                            : 'Allumer le téléviseur'
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
                        disabled={!power || volume <= 0}
                        onClick={() => setVolume(Math.max(0, volume - 1))}
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
                                fontSize: 26,
                                fontWeight: 700,
                                lineHeight: 1.1,
                                color: dim
                                    ? 'rgba(245,245,220,0.45)'
                                    : '#F5F5DC',
                            }}
                        >
                            {mute ? 'Muet' : volume}
                        </Typography>
                        <Typography
                            sx={{ fontSize: 11, color: 'text.secondary' }}
                        >
                            / {maxVolume}
                        </Typography>
                    </Box>

                    <ButtonBase
                        aria-label="Augmenter le volume"
                        disabled={!power || volume >= maxVolume}
                        onClick={() =>
                            setVolume(Math.min(maxVolume, volume + 1))
                        }
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

                <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="center"
                    spacing={1}
                    sx={{ mt: 1 }}
                >
                    <ButtonBase
                        aria-label={mute ? 'Activer le son' : 'Couper le son'}
                        disabled={!power}
                        onClick={() => setMute(!mute)}
                        sx={{
                            ...chipBase,
                            flex: 'none',
                            minWidth: 90,
                            flexDirection: 'row',
                            color: mute ? '#FF5D5D' : GOLD,
                            ...(mute ? activeChip('#FF5D5D') : activeChip()),
                        }}
                    >
                        {mute ? (
                            <VolumeOffIcon fontSize="small" />
                        ) : (
                            <VolumeUpIcon fontSize="small" />
                        )}
                        <Typography sx={{ fontSize: 12, lineHeight: 1.2 }}>
                            {mute ? 'Muet' : 'Son'}
                        </Typography>
                    </ButtonBase>
                </Stack>
            </Box>

            {/* ── Inputs ───────────────────────────────────── */}
            {sources.length > 0 && (
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
                        {sources.map((s) => {
                            const Icon = sourceIcon(s.title);
                            const isActive =
                                content?.uri === s.uri ||
                                String(s.status ?? '')
                                    .toLowerCase()
                                    .includes('active');
                            return (
                                <ButtonBase
                                    key={s.uri ?? s.title}
                                    aria-pressed={isActive}
                                    disabled={!power}
                                    onClick={() => switchSource(s)}
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
                                        {s.title ?? s.uri}
                                    </Typography>
                                </ButtonBase>
                            );
                        })}
                    </Box>
                </Box>
            )}
            <Box sx={{ mt: 2 }}>
                <Typography sx={SECTION_LABEL}>Télécommande</Typography>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 56px)',
                        justifyContent: 'center',
                        gap: 1,
                    }}
                >
                    <Box />
                    <ButtonBase
                        aria-label="Haut"
                        disabled={!power || busy}
                        onClick={() => pressKey('Up')}
                        sx={keyBase}
                    >
                        <ArrowUpwardIcon fontSize="small" />
                    </ButtonBase>
                    <Box />

                    <ButtonBase
                        aria-label="Gauche"
                        disabled={!power || busy}
                        onClick={() => pressKey('Left')}
                        sx={keyBase}
                    >
                        <ArrowLeftIcon fontSize="small" />
                    </ButtonBase>
                    <ButtonBase
                        aria-label="OK"
                        disabled={!power || busy}
                        onClick={() => pressKey('Confirm')}
                        sx={{
                            ...keyBase,
                            backgroundColor:
                                'linear-gradient(135deg, rgba(255,215,0,0.22), rgba(255,215,0,0.06))',
                            boxShadow: glow(GOLD, 0.25),
                        }}
                    >
                        <CheckIcon fontSize="small" />
                    </ButtonBase>
                    <ButtonBase
                        aria-label="Droite"
                        disabled={!power || busy}
                        onClick={() => pressKey('Right')}
                        sx={keyBase}
                    >
                        <ArrowRightIcon fontSize="small" />
                    </ButtonBase>

                    <Box />
                    <ButtonBase
                        aria-label="Bas"
                        disabled={!power || busy}
                        onClick={() => pressKey('Down')}
                        sx={keyBase}
                    >
                        <ArrowDownwardIcon fontSize="small" />
                    </ButtonBase>
                    <Box />
                </Box>

                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: 0.75,
                        mt: 1.5,
                    }}
                >
                    {QUICK_LAUNCH.map((q) => {
                        const Icon = q.icon;
                        return (
                            <ButtonBase
                                key={q.key}
                                disabled={!power || busy}
                                onClick={() => {
                                    const match = apps.find(
                                        (a) =>
                                            (
                                                a.title ?? a.name
                                            ).toLowerCase() ===
                                            q.label.toLowerCase()
                                    );
                                    console.log(apps);
                                    if (match) {
                                        call(device?._id, 'setActiveApp', {
                                            uri: match.uri,
                                            data: match.data ?? '',
                                        });
                                    } else {
                                        pressKey(q.key);
                                    }
                                }}
                                sx={keyBase}
                            >
                                <Icon fontSize="small" />
                                <Typography
                                    sx={{ fontSize: 10, lineHeight: 1.1 }}
                                >
                                    {q.label}
                                </Typography>
                            </ButtonBase>
                        );
                    })}
                </Box>
            </Box>
        </Box>
    );
};

export default TVControls;
