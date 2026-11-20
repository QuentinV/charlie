import React from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Link,
    Paper,
    Stack,
    Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import { HOST, api, apiBlob, getToken } from '../../api/charlie';
import { SECTION_LABEL } from '../DeviceControls/types/typeStyles';

/**
 * The camera panel's live view: the stream, the events vision reported, and an
 * on-demand description.
 *
 * The stream is a plain MJPEG `<img>` — browsers play it natively, no JS
 * plumbing — which is also why its URL carries `?token=`: an `<img>` cannot send
 * an Authorization header, and the gate accepts a query token on that one route.
 * A source the browser cannot play (`webcam` / `rtsp` / `echo`) falls back to
 * polling the single frame the brain can grab, and shows the reason when it
 * cannot even do that.
 */
const STILL_INTERVAL_MS = 1500;
// The event timeline is a poll, so this *is* the delay a gesture or an arrival is
// seen with in the panel (measured: a 3 s poll added up to 3 s on top of the feed's
// own latency). The panel is only mounted while it is open, so 1 s costs nothing.
const EVENTS_INTERVAL_MS = 1000;

/** The live stream URL, with the session token the tag cannot send itself. */
export function streamUrl(deviceId, token = getToken()) {
    return `${HOST}/devices/${deviceId}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/**
 * Keyframe thumbnails are fetched once per file and kept as object URLs (a
 * keyframe URL cannot carry a token either — it is not the media route).
 */
const thumbnails = new Map();

function Keyframe({ file }) {
    const [url, setUrl] = React.useState(() => thumbnails.get(file) ?? null);

    React.useEffect(() => {
        if (!file) {
            setUrl(null);
            return;
        }
        if (thumbnails.has(file)) {
            setUrl(thumbnails.get(file));
            return;
        }
        let alive = true;
        apiBlob(`vision/keyframes/${file}`).then((next) => {
            if (!alive) {
                if (next) URL.revokeObjectURL(next);
                return;
            }
            if (!next) return;
            // Keep the cache bounded: a long session must not leak blobs.
            if (thumbnails.size > 60) {
                thumbnails.forEach((old) => URL.revokeObjectURL(old));
                thumbnails.clear();
            }
            thumbnails.set(file, next);
            setUrl(next);
        });
        return () => {
            alive = false;
        };
    }, [file]);

    if (!url) return null;
    return (
        <Box
            component="img"
            src={url}
            alt=""
            sx={{
                width: 96,
                height: 54,
                objectFit: 'cover',
                borderRadius: 1,
                flexShrink: 0,
            }}
        />
    );
}

/**
 * The live view of a camera device: the stream, what vision reported, and a way
 * to ask what it sees right now.
 */
export const CameraVision = ({ device }) => {
    const { t } = useTranslation();
    const deviceId = device?._id;
    const [mode, setMode] = React.useState('stream');
    const [still, setStill] = React.useState(null);
    const [unavailable, setUnavailable] = React.useState(null);
    const [reload, setReload] = React.useState(0);
    const [events, setEvents] = React.useState([]);
    const [described, setDescribed] = React.useState(null);
    const [busy, setBusy] = React.useState(false);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const src = React.useMemo(() => streamUrl(deviceId), [deviceId, reload]);

    /** The stream refused (415, unreachable…): fall back to the grabbed frame. */
    const onStreamError = () => {
        setMode((current) => (current === 'stream' ? 'still' : current));
        setReload((n) => n + 1);
    };

    React.useEffect(() => {
        if (mode !== 'still' || !deviceId) return;
        let alive = true;
        let current = null;

        const tick = async () => {
            const next = await apiBlob(`devices/${deviceId}/snapshot`);
            if (!alive) {
                if (next) URL.revokeObjectURL(next);
                return;
            }
            if (!next) {
                setUnavailable(t('cameraVision.noFrame'));
                return;
            }
            if (current) URL.revokeObjectURL(current);
            current = next;
            setUnavailable(null);
            setStill(next);
        };

        tick();
        const timer = setInterval(tick, STILL_INTERVAL_MS);
        return () => {
            alive = false;
            clearInterval(timer);
            if (current) URL.revokeObjectURL(current);
        };
    }, [mode, deviceId, t]);

    React.useEffect(() => {
        if (!deviceId) return;
        let alive = true;
        const tick = async () => {
            const res = await api(
                `vision/cameras/${deviceId}/events?limit=20`
            ).catch(() => null);
            if (alive) setEvents(res?.events ?? []);
        };

        tick();
        const timer = setInterval(tick, EVENTS_INTERVAL_MS);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [deviceId]);

    const runDescribe = async () => {
        setBusy(true);
        try {
            const res = await api(`vision/cameras/${deviceId}/describe`, {
                method: 'POST',
            });
            setDescribed(
                res ?? { ok: false, error: t('cameraVision.describeFailed') }
            );
        } catch (e) {
            setDescribed({ ok: false, error: e.message });
        } finally {
            setBusy(false);
        }
    };

    const reconnect = () => {
        setUnavailable(null);
        setMode('stream');
        setReload((n) => n + 1);
    };

    return (
        <>
            <Typography sx={SECTION_LABEL}>
                {t('cameraVision.title')}
            </Typography>

            <Box
                sx={{
                    borderRadius: 2,
                    overflow: 'hidden',
                    bgcolor: '#000',
                    minHeight: 150,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                {unavailable ? (
                    <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ p: 2, textAlign: 'center' }}
                    >
                        {unavailable}
                    </Typography>
                ) : mode === 'stream' ? (
                    <Box
                        component="img"
                        src={src}
                        onError={onStreamError}
                        alt={device?.name ?? ''}
                        sx={{ width: '100%', display: 'block' }}
                    />
                ) : still ? (
                    <Box
                        component="img"
                        src={still}
                        alt=""
                        sx={{ width: '100%', display: 'block' }}
                    />
                ) : (
                    <CircularProgress size={22} />
                )}
            </Box>

            <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ mt: 0.5 }}
            >
                <Chip
                    size="small"
                    variant="outlined"
                    color={mode === 'stream' ? 'success' : 'default'}
                    label={
                        mode === 'stream'
                            ? t('cameraVision.live')
                            : t('cameraVision.still')
                    }
                />
                <Button size="small" startIcon={<RefreshIcon />} onClick={reconnect}>
                    {t('cameraVision.reconnect')}
                </Button>
            </Stack>

            <Button
                size="small"
                disabled={busy}
                onClick={runDescribe}
                sx={{ mt: 0.5, alignSelf: 'flex-start' }}
            >
                {busy
                    ? t('cameraVision.describing')
                    : t('cameraVision.describe')}
            </Button>

            {described && (
                <Alert
                    severity={described.ok ? 'info' : 'warning'}
                    sx={{ mt: 0.5 }}
                    onClose={() => setDescribed(null)}
                >
                    {described.ok
                        ? `${described.text} (${described.tier})`
                        : described.error}
                </Alert>
            )}

            <Typography sx={SECTION_LABEL}>
                {t('cameraVision.events')}
            </Typography>
            {events.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                    {t('cameraVision.noEvents')}
                </Typography>
            ) : (
                <Stack spacing={0.75}>
                    {events.map((event, index) => (
                        <Paper
                            key={`${event.at}-${event.kind}-${event.trackId ?? index}`}
                            variant="outlined"
                            sx={{
                                p: 1,
                                display: 'flex',
                                gap: 1,
                                alignItems: 'center',
                            }}
                        >
                            <Keyframe file={event.keyframe} />
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                                <Typography
                                    variant="body2"
                                    sx={{ fontWeight: 600 }}
                                >
                                    {t(`cameraVision.kind.${event.kind}`, {
                                        defaultValue: event.kind,
                                    })}
                                    {event.classes?.length
                                        ? ` — ${event.classes.join(', ')}`
                                        : ''}
                                </Typography>
                                {event.vlm?.text && (
                                    <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        display="block"
                                    >
                                        {event.vlm.text}
                                    </Typography>
                                )}
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    display="block"
                                >
                                    {new Date(event.at).toLocaleTimeString()}
                                    {event.modes?.length
                                        ? ` · ${event.modes.join(', ')}`
                                        : ''}
                                    {event.vlm?.tier
                                        ? ` · ${event.vlm.tier}`
                                        : ''}
                                </Typography>
                            </Box>
                        </Paper>
                    ))}
                </Stack>
            )}

            <Link
                component={RouterLink}
                to="/activities"
                variant="caption"
                sx={{ mt: 0.5, display: 'inline-block' }}
            >
                {t('cameraVision.openJournal')}
            </Link>
        </>
    );
};

export default CameraVision;
