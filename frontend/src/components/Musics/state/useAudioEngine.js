import { useRef, useEffect } from 'react';
import { api } from '../../../api/charlie';

function executePlayerCommand({
    command,
    songId = undefined,
    volume = undefined,
    offset = undefined,
}) {
    return api('musics/player', {
        body: JSON.stringify({
            command,
            volume,
            offset,
            songId,
        }),
    });
}

export default function useAudioEngine({ device, songId = undefined }) {
    const audioRef = useRef(new Audio());

    useEffect(() => {
        console.log('src', songId);
        audioRef.current.src =
            device === 'local' && songId
                ? `/api/musics/songs/${songId}/stream`
                : undefined;
    }, [songId, device]);

    return {
        play: async () =>
            device === 'local'
                ? audioRef.current.play()
                : executePlayerCommand({ command: 'play', songId }),
        pause: async () =>
            device === 'local'
                ? audioRef.current.pause()
                : executePlayerCommand({ command: 'pause' }),
        setVolume: async (v) =>
            device === 'local'
                ? (audioRef.current.volume = v)
                : executePlayerCommand({ command: 'volume', volume: v }),
        seek: (t) =>
            device === 'local'
                ? (audioRef.current.currentTime = t)
                : executePlayerCommand({ command: 'seek', offset: t }),
        getTime: async () =>
            device === 'local'
                ? audioRef.current.currentTime
                : (await api('musics/player'))?.time,
    };
}
