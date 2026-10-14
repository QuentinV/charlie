import React from 'react';
import {
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import MemoryBrain from './MemoryBrain';
import { api } from '../../api/charlie';

const LAST_KEY = 'charlie.memory.user';

function itemCount(u) {
    return (
        (u?.counts?.preferences ?? 0) +
        (u?.counts?.facts ?? 0) +
        (u?.counts?.topics ?? 0)
    );
}

function Empty({ text }) {
    return (
        <Box
            sx={{
                display: 'flex',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                p: 4,
            }}
        >
            <Typography
                variant="body2"
                color="text.secondary"
                textAlign="center"
            >
                {text}
            </Typography>
        </Box>
    );
}

export default function Memory() {
    const [users, setUsers] = React.useState([]);
    const [selected, setSelected] = React.useState(
        () => localStorage.getItem(LAST_KEY) ?? ''
    );
    const [profile, setProfile] = React.useState(null);
    const [loadingUsers, setLoadingUsers] = React.useState(true);
    const [loadingProfile, setLoadingProfile] = React.useState(false);
    const [confirmOpen, setConfirmOpen] = React.useState(false);

    const loadUsers = React.useCallback(async () => {
        setLoadingUsers(true);
        try {
            const res = await api('memory');
            const list = res?.users ?? [];
            setUsers(list);
            setSelected((prev) =>
                prev && list.some((u) => u.user === prev)
                    ? prev
                    : (list[0]?.user ?? '')
            );
        } finally {
            setLoadingUsers(false);
        }
    }, []);

    React.useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    const loadProfile = React.useCallback(async (user) => {
        if (!user) {
            setProfile(null);
            return;
        }
        setLoadingProfile(true);
        try {
            setProfile(await api(`memory/${encodeURIComponent(user)}`));
        } finally {
            setLoadingProfile(false);
        }
    }, []);

    React.useEffect(() => {
        if (!selected) {
            setProfile(null);
            return;
        }
        localStorage.setItem(LAST_KEY, selected);
        loadProfile(selected);
    }, [selected, loadProfile]);

    const forget = async () => {
        if (!selected) return;
        await api(`memory/${encodeURIComponent(selected)}`, {
            method: 'DELETE',
        });
        setConfirmOpen(false);
        await loadUsers();
        await loadProfile(selected);
    };

    const hasData =
        !!profile &&
        ((profile.facts?.length ?? 0) > 0 ||
            Object.keys(profile.preferences ?? {}).length > 0 ||
            Object.keys(profile.topics ?? {}).length > 0 ||
            !!profile.summary);

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                height: '100%',
            }}
        >
            <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="h5" sx={{ fontWeight: 700, flexGrow: 1 }}>
                    Mémoire
                </Typography>
                <IconButton
                    onClick={loadUsers}
                    disabled={loadingUsers}
                    title="Rafraîchir"
                >
                    <RefreshIcon />
                </IconButton>
                <IconButton
                    onClick={() => setConfirmOpen(true)}
                    disabled={!hasData}
                    color="error"
                    title="Oublier ce profil"
                >
                    <DeleteOutlineIcon />
                </IconButton>
            </Stack>

            <FormControl size="small" sx={{ minWidth: 240, maxWidth: 360 }}>
                <InputLabel id="memory-user-label">Profil</InputLabel>
                <Select
                    labelId="memory-user-label"
                    label="Profil"
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                    disabled={loadingUsers || !users.length}
                >
                    {users.map((u) => (
                        <MenuItem key={u.user} value={u.user}>
                            {u.user}
                            {itemCount(u) ? ` · ${itemCount(u)}` : ''}
                            {u.hasMemory ? '' : ' (vide)'}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            <Box
                sx={{
                    flexGrow: 1,
                    minHeight: 0,
                    borderRadius: 3,
                    border: '1px solid rgba(255,215,0,0.12)',
                    background:
                        'radial-gradient(circle at 50% 45%, rgba(255,215,0,0.06), rgba(10,10,11,0) 60%)',
                    overflow: 'hidden',
                }}
            >
                {loadingUsers || loadingProfile ? (
                    <Box
                        sx={{
                            display: 'flex',
                            height: '100%',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <CircularProgress />
                    </Box>
                ) : !selected ? (
                    <Empty text="Aucun profil pour le moment. La mémoire se remplit au fil des conversations." />
                ) : !hasData ? (
                    <Empty text="Aucune mémoire enregistrée pour ce profil." />
                ) : (
                    <MemoryBrain profile={profile} />
                )}
            </Box>

            <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
                <DialogTitle>Oublier {selected} ?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Toute la mémoire de ce profil sera définitivement
                        supprimée.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmOpen(false)}>
                        Annuler
                    </Button>
                    <Button color="error" onClick={forget}>
                        Oublier
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
