import React, { useEffect, useState } from 'react';
import { DevicesList } from '../Devices';
import {
    Box,
    Card,
    Typography,
    IconButton,
    Collapse,
    alpha,
    useTheme,
    useMediaQuery,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { api } from '../../api/charlie';

export const RoomsList = ({ favoriteDeviceIds = [], onToggleFavorite }) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const [rooms, setRooms] = useState(/** @type {any[]} */ ([]));
    const [expanded, setExpanded] = useState(
        /** @type {Record<string, boolean>} */ ({})
    );

    useEffect(() => {
        (async () => {
            /** @type {Record<string, any>} */
            const devices = (await api('devices')).reduce((p, d) => {
                p[d._id] = d;
                return p;
            }, {});

            /** @type {any[]} */
            const rooms = await api('rooms');
            rooms
                .sort((a, b) => String(a?.name).localeCompare(String(b?.name)))
                .forEach((room) => {
                    room.devices =
                        room.devices
                            ?.map((d) => devices[d])
                            ?.sort((a, b) => (a?.name > b?.name ? 1 : -1)) ??
                        [];
                });

            rooms.push({
                name: 'Maison',
                devices: Object.entries(devices ?? {})
                    .filter(
                        ([d]) =>
                            !rooms.some((r) =>
                                r.devices?.some((rd) => rd?._id === d)
                            )
                    )
                    .map(([, d]) => d),
            });

            setRooms(rooms);
            // Start with all rooms expanded
            setExpanded(
                Object.fromEntries(rooms.map((r) => [r._id ?? r.name, true]))
            );
        })();
    }, []);

    /**
     * @param {string} key
     */
    const toggleExpanded = (key) => {
        setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: isMobile ? 1 : 1.25,
            }}
        >
            {rooms.map((r) => {
                const key = r._id ?? r.name;
                const isExpanded = expanded[key] ?? true;
                const onCount = r.devices?.filter(
                    (/** @type {any} */ d) => d?.state?.power === 'on'
                )?.length;

                return (
                    <Card
                        key={key}
                        sx={{
                            overflow: 'hidden',
                            borderRadius: isMobile ? 2.5 : 3,
                        }}
                    >
                        {/* Header — tap to expand/collapse */}
                        <Box
                            role="button"
                            aria-expanded={isExpanded}
                            onClick={() => toggleExpanded(key)}
                            sx={{
                                px: isMobile ? 1 : 1.5,
                                py: isMobile ? 0.75 : 1,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                cursor: 'pointer',
                                transition: 'background-color .15s ease',
                                '&:hover': {
                                    backgroundColor: alpha(
                                        theme.palette.primary.main,
                                        0.05
                                    ),
                                },
                            }}
                        >
                            {/* Room icon */}
                            <Box
                                sx={{
                                    width: isMobile ? 32 : 40,
                                    height: isMobile ? 32 : 40,
                                    borderRadius: isMobile ? 1.5 : 2,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    bgcolor: alpha(
                                        theme.palette.primary.main,
                                        0.1
                                    ),
                                    color: 'primary.main',
                                    fontSize: isMobile ? '1.25rem' : '1.5rem',
                                }}
                            >
                                {r._id ? '🏠' : '🏡'}
                            </Box>

                            {/* Name + device summary */}
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography
                                    variant={isMobile ? 'body1' : 'h6'}
                                    sx={{
                                        fontWeight: 700,
                                        mb: 0,
                                        fontSize: isMobile
                                            ? '0.875rem'
                                            : '1.5rem',
                                    }}
                                >
                                    {r.name}
                                </Typography>
                                <Box
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 0.5,
                                        mt: 0.125,
                                    }}
                                >
                                    {onCount > 0 && (
                                        <Box
                                            sx={{
                                                width: 6,
                                                height: 6,
                                                borderRadius: '50%',
                                                bgcolor: 'success.main',
                                                boxShadow:
                                                    '0 0 4px rgba(76, 217, 100, .5)',
                                            }}
                                        />
                                    )}
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            color: 'text.secondary',
                                            fontSize: isMobile
                                                ? '0.75rem'
                                                : '0.875rem',
                                        }}
                                    >
                                        {r.devices?.length ?? 0} devices
                                        {onCount > 0 ? ` · ${onCount} on` : ''}
                                    </Typography>
                                </Box>
                            </Box>

                            {/* Expand/collapse chevron */}
                            <IconButton
                                size="small"
                                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                                sx={{
                                    color: 'text.secondary',
                                    transition: 'transform .2s ease',
                                    transform: isExpanded
                                        ? 'rotate(180deg)'
                                        : 'rotate(0deg)',
                                }}
                            >
                                <ExpandMoreIcon />
                            </IconButton>
                        </Box>

                        {/* Collapsible device grid */}
                        <Collapse in={isExpanded} timeout={250}>
                            <Box
                                sx={{
                                    px: isMobile ? 1 : 1.5,
                                    pb: isMobile ? 0.5 : 1,
                                    pt: isMobile ? 0.25 : 0.5,
                                }}
                            >
                                <DevicesList
                                    devices={r.devices}
                                    favoriteDeviceIds={favoriteDeviceIds}
                                    onToggleFavorite={onToggleFavorite}
                                />
                            </Box>
                        </Collapse>
                    </Card>
                );
            })}
        </Box>
    );
};
