import React, { useEffect, useState } from 'react';
import {
    Divider,
    Drawer,
    IconButton,
    List,
    ListItemButton,
    ListItemText,
} from '@mui/material';
import QueueMusicIcon from '@mui/icons-material/QueueMusic';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

export default function PlaylistDrawer({
    playlist = undefined,
    playlists,
    songId = undefined,
    onSelectSong,
}) {
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [activePlaylist, setActivePlaylist] = useState(null);

    useEffect(() => {
        setActivePlaylist(playlist);
    }, [playlist]);

    console.log(playlist, activePlaylist);

    return (
        <>
            <IconButton onClick={() => setDrawerOpen(true)}>
                <QueueMusicIcon />
            </IconButton>
            <Drawer
                anchor="left"
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
            >
                <div style={{ width: 300 }}>
                    <h3 style={{ padding: '16px' }}>
                        {activePlaylist && (
                            <IconButton onClick={() => setActivePlaylist(null)}>
                                <ArrowBackIcon />
                            </IconButton>
                        )}
                        {activePlaylist ? activePlaylist.name : 'Playlists'}
                    </h3>

                    <Divider />

                    {activePlaylist ? (
                        <List>
                            {(activePlaylist.songs ?? []).map((song) => (
                                <ListItemButton
                                    key={song.id}
                                    selected={song.id === songId}
                                    onClick={() => {
                                        onSelectSong(playlist, song);
                                        setDrawerOpen(false);
                                    }}
                                >
                                    <ListItemText primary={song.name} />
                                </ListItemButton>
                            ))}
                        </List>
                    ) : (
                        <List>
                            {playlists?.map((pl) => (
                                <ListItemButton
                                    key={pl.id}
                                    onClick={() => setActivePlaylist(pl)}
                                >
                                    <ListItemText primary={pl.name} />
                                </ListItemButton>
                            ))}
                        </List>
                    )}
                </div>
            </Drawer>
        </>
    );
}
