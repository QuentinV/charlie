import React, { useEffect, useState } from 'react';
import DeviceSelector from './DeviceSelector';
import { Box, IconButton, Slider, Stack, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import useAudioEngine from './state/useAudioEngine';
import { api } from '../../api/charlie';
import PlaylistDrawer from './PlaylistDrawer';

const devices = [
    { id: 'local', name: 'Local' },
    { id: 'server', name: 'Server' },
];

let updateTimeInterval = null;

export default function Musics() {
    const [device, setDevice] = useState('local');
    const [isPlaying, setIsPlaying] = useState(false);
    const [time, setTime] = useState(null);
    const [song, setSong] = useState(null);
    const [playlist, setPlaylist] = useState(null);
    const [playlists, setPlaylists] = useState([]);

    const { play, pause, seek, getTime } = useAudioEngine({
        device,
        songId: song?.id,
    });

    useEffect(() => {
        (async () => {
            const state = await api('musics/player');
            setTime(state?.time ?? null);
            setIsPlaying(state?.isPlaying ?? false);
        })();
    }, []);

    useEffect(() => {
        (async () => {
            const data = await api('musics/playlists');
            setPlaylists(data);
        })();
    }, []);

    const changePlayState = async () => {
        updateTimeInterval && clearInterval(updateTimeInterval);
        if (!isPlaying) {
            await play();
            updateTimeInterval = setInterval(async () => {
                setTime(await getTime());
            }, 1000);
        } else {
            await pause();
        }
        setIsPlaying(!isPlaying);
    };
    const onNext = () => {};

    const t = time ?? 0;
    const timeMin = Math.floor(t / 60);
    const timeSec = Math.floor(t - timeMin * 60);

    const d = song?.duration ?? 0;
    const dMin = Math.floor(d / 60);
    const dSec = Math.floor(d - dMin * 60);

    return (
        <Box
            sx={{
                flexGrow: 0,
                color: 'white',
                display: 'flex',
                width: '100%',
                flexDirection: 'column',
                alignItems: 'center',
            }}
        >
            <Stack
                direction="row"
                spacing={1}
                justifyContent="center"
                alignItems="center"
                width="100%"
                height="20px"
                marginTop="10px"
            >
                <Typography flex="0 0 40px" align="center" variant="body2">
                    {time === null ? (
                        '--:--'
                    ) : (
                        <>
                            {timeMin < 10 ? '0' : ''}
                            {timeMin}:{timeSec < 10 ? '0' : ''}
                            {timeSec}
                        </>
                    )}
                </Typography>
                <Slider
                    sx={{ flex: 1 }}
                    value={t}
                    max={d}
                    onChange={(_, v) => seek(v)}
                    size="small"
                />
                <Typography flex="0 0 40px" align="center" variant="body2">
                    {song?.duration === undefined ? (
                        '--:--'
                    ) : (
                        <>
                            {dMin < 10 ? '0' : ''}
                            {dMin}:{dSec < 10 ? '0' : ''}
                            {dSec}
                        </>
                    )}
                </Typography>
            </Stack>
            <Typography>{song?.name ?? ''}</Typography>
            <Stack
                direction="row"
                spacing={2}
                justifyContent="center"
                sx={{ margin: 0 }}
                width="100%"
            >
                <PlaylistDrawer
                    onSelectSong={(pl, song) => {
                        setPlaylist(pl);
                        setSong(song);
                    }}
                    playlist={playlist}
                    playlists={playlists}
                />
                <IconButton onClick={() => console.log('prev')}>
                    <SkipPreviousIcon />
                </IconButton>
                <IconButton onClick={changePlayState}>
                    {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
                </IconButton>
                <IconButton onClick={onNext}>
                    <SkipNextIcon />
                </IconButton>
                <DeviceSelector
                    devices={devices}
                    currentDevice={device}
                    onSelect={setDevice}
                />
            </Stack>
        </Box>
    );
}
