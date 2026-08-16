import React, { useEffect, useState, useCallback } from 'react';
import { DevicesList } from '../Devices';
import {
    Box,
    Card,
    Typography,
    IconButton,
    Collapse,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Button,
    alpha,
    useTheme,
    useMediaQuery,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { api } from '../../api/charlie';
import { useLongPress } from '../../hooks/useLongPress';

/**
 * @param {{
 *   room: any;
 *   isExpanded: boolean;
 *   onToggle: () => void;
 *   isMobile: boolean;
 *   favoriteDeviceIds?: string[];
 *   onToggleFavorite?: (device: any) => void;
 *   onEditRoom: (room: any) => void;
 * }} props
 */
function RoomCard({
    room,
    isExpanded,
    onToggle,
    isMobile,
    favoriteDeviceIds = [],
    onToggleFavorite,
    onEditRoom,
}) {
    const theme = useTheme();
    const onCount = room.devices?.filter(
        (/** @type {any} */ d) => d?.state?.power === 'on'
    )?.length;

    // The synthetic "Maison" room has no _id — it cannot be renamed/deleted
    const isRealRoom = Boolean(room._id);

    /** @type {React.MutableRefObject<boolean>} */
    const longPressHandledRef = React.useRef(false);

    const longPressProps = useLongPress(() => {
        if (!isRealRoom) return;
        longPressHandledRef.current = true;
        onEditRoom(room);
    });

    return (
        <Card
            sx={{
                overflow: 'hidden',
                borderRadius: isMobile ? 2.5 : 3,
            }}
        >
            {/* Header — tap to expand/collapse, long-press to edit/delete */}
            <Box
                role="button"
                aria-expanded={isExpanded}
                onClick={() => {
                    if (longPressHandledRef.current) {
                        // Long-press just fired — don't toggle expand state
                        longPressHandledRef.current = false;
                        return;
                    }
                    onToggle();
                }}
                {...longPressProps}
                sx={{
                    px: isMobile ? 1 : 1.5,
                    py: isMobile ? 0.75 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    cursor: 'pointer',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    touchAction: 'pan-y',
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
                        bgcolor: alpha(theme.palette.primary.main, 0.1),
                        color: 'primary.main',
                        fontSize: isMobile ? '1.25rem' : '1.5rem',
                    }}
                >
                    {room._id ? '🏠' : '🏡'}
                </Box>

                {/* Name + device summary */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        variant={isMobile ? 'body1' : 'h6'}
                        sx={{
                            fontWeight: 700,
                            mb: 0,
                            fontSize: isMobile ? '0.875rem' : '1.5rem',
                        }}
                    >
                        {room.name}
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
                                    boxShadow: '0 0 4px rgba(76, 217, 100, .5)',
                                }}
                            />
                        )}
                        <Typography
                            variant="caption"
                            sx={{
                                color: 'text.secondary',
                                fontSize: isMobile ? '0.75rem' : '0.875rem',
                            }}
                        >
                            {room.devices?.length ?? 0} devices
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
                        devices={room.devices}
                        favoriteDeviceIds={favoriteDeviceIds}
                        onToggleFavorite={onToggleFavorite}
                    />
                </Box>
            </Collapse>
        </Card>
    );
}

export const RoomsList = ({ favoriteDeviceIds = [], onToggleFavorite }) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const [rooms, setRooms] = useState(/** @type {any[]} */ ([]));
    const [expanded, setExpanded] = useState(
        /** @type {Record<string, boolean>} */ ({})
    );

    // Dialog state for renaming/deleting a room
    const [editRoom, setEditRoom] = useState(/** @type {any | null} */ (null));
    const [editRoomName, setEditRoomName] = useState('');

    const loadRooms = useCallback(async () => {
        /** @type {Record<string, any>} */
        const devices = (await api('devices')).reduce((p, d) => {
            p[d._id] = d;
            return p;
        }, {});

        /** @type {any[]} */
        const fetchedRooms = await api('rooms');
        fetchedRooms
            .sort((a, b) => String(a?.name).localeCompare(String(b?.name)))
            .forEach((room) => {
                room.devices =
                    room.devices
                        ?.map((d) => devices[d])
                        ?.sort((a, b) => (a?.name > b?.name ? 1 : -1)) ?? [];
            });

        fetchedRooms.push({
            name: 'Maison',
            devices: Object.entries(devices ?? {})
                .filter(
                    ([d]) =>
                        !fetchedRooms.some((r) =>
                            r.devices?.some((rd) => rd?._id === d)
                        )
                )
                .map(([, d]) => d),
        });

        setRooms(fetchedRooms);
        // Start with all rooms expanded
        setExpanded(
            Object.fromEntries(fetchedRooms.map((r) => [r._id ?? r.name, true]))
        );
    }, []);

    useEffect(() => {
        loadRooms();
    }, [loadRooms]);

    /**
     * @param {string} key
     */
    const toggleExpanded = (key) => {
        setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const handleOpenEdit = (room) => {
        setEditRoom(room);
        setEditRoomName(room.name);
    };

    const handleSave = async () => {
        if (!editRoom?._id) return;
        await api(`rooms/${editRoom._id}`, {
            method: 'PUT',
            body: JSON.stringify({ name: editRoomName }),
        });
        setEditRoom(null);
        await loadRooms();
    };

    const handleDelete = async () => {
        if (!editRoom?._id) return;
        if (window.confirm(`Delete room "${editRoom.name}"?`)) {
            await api(`rooms/${editRoom._id}`, { method: 'DELETE' });
            setEditRoom(null);
            await loadRooms();
        }
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

                return (
                    <RoomCard
                        key={key}
                        room={r}
                        isExpanded={isExpanded}
                        onToggle={() => toggleExpanded(key)}
                        isMobile={isMobile}
                        favoriteDeviceIds={favoriteDeviceIds}
                        onToggleFavorite={onToggleFavorite}
                        onEditRoom={handleOpenEdit}
                    />
                );
            })}

            {/* Rename/Delete dialog */}
            <Dialog
                open={Boolean(editRoom)}
                onClose={() => setEditRoom(null)}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>Edit room</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        label="Room name"
                        value={editRoomName}
                        onChange={(event) =>
                            setEditRoomName(event.target.value)
                        }
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') handleSave();
                        }}
                        sx={{ mt: 1 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={handleDelete}
                        color="error"
                        disabled={!editRoom?._id}
                    >
                        Delete
                    </Button>
                    <Box sx={{ flex: 1 }} />
                    <Button onClick={() => setEditRoom(null)}>Cancel</Button>
                    <Button
                        onClick={handleSave}
                        color="primary"
                        variant="contained"
                        disabled={!editRoomName?.trim()}
                    >
                        Save
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
