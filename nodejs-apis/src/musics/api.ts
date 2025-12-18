import { RestApis } from '../types';
import {
    audioPlayer,
    executeCommand,
    getSongById,
    searchLibrary,
    streamMusic,
} from './service';

const routes: RestApis = {
    /*'musics/playlists': {
        get: {
            handler: async () =>
                cs.musics_playlists
                    .find({}, { projection: { _id: 1, name: 1 } })
                    .toArray(),
            description: 'List all playlists',
        },
        post: {
            handler: async ({ body }) => {
                const id = uuidV4();
                await cs.musics_playlists.insertOne({
                    _id: id,
                    name: body?.name ?? 'MyPlaylist',
                });
                return { id };
            },
            description: 'Create a new playlist',
        },
    },
    'musics/playlists/:id': {
        get: {
            handler: async ({ params }) => getPlaylistById(params.id),
            description: 'Get a playlist',
        },
        put: {
            handler: async ({ params, body }) => {
                await cs.musics_playlists.updateOne(
                    { _id: params.id },
                    { $set: { name: body?.name } }
                );
            },
            description: 'Change a playlist',
        },
    },
    'musics/playlist/:pid/songs': {
        post: {
            handler: async ({ params, body }) => {
                const playlist = await cs.musics_playlists.findOne({
                    _id: params.pid,
                });
                const song = await getSongById(body.songId);
                if (!playlist.songs) playlist.songs = [];
                playlist.songs.push(song.path);
                console.log(playlist);
                await cs.musics_playlists.updateOne(
                    { _id: params.pid },
                    { $set: { songs: playlist.songs } }
                );
            },
            description: 'Add a song to a playlist',
        },
        delete: {
            handler: async ({ params, body }) => {
                const playlist = await cs.musics_playlists.findOne({
                    _id: params.pid,
                });
                const song = await getSongById(body.songId);
                await cs.musics_playlists.updateOne(
                    { _id: params.pid },
                    {
                        $set: {
                            songs: playlist.songs.filter(
                                (s) => s !== song.path
                            ),
                        },
                    }
                );
            },
            description: 'Delete a song from a playlist',
        },
    },*/
    'musics/songs': {
        get: {
            handler: async ({ query }) => searchLibrary(query),
            description: 'Search songs from library',
            querySchema: { q: { type: 'string' } },
        },
    },
    'musics/songs/:id/stream': {
        get: {
            fullHandler: async ({ params, headers }, res) => {
                const data = await streamMusic(params.id, headers.range);
                if (data.range) {
                    res.writeHead(206, {
                        'Content-Range': data.range,
                        'Accept-Ranges': 'bytes',
                        'Content-Length': data.size,
                        'Content-Type': data.type,
                    });
                } else {
                    res.writeHead(200, {
                        'Content-Length': data.size,
                        'Content-Type': data.type,
                    });
                }

                data.stream.pipe(res);
            },
            description: 'Stream a song',
        },
    },
    'musics/player': {
        get: {
            handler: async () => audioPlayer.status(),
            description: 'Get state of player',
        },
        post: {
            handler: async ({ body }) => executeCommand(body),
            description: 'Start/Stop/Pause a song on the serve',
        },
    },
    'musics/songs/:id': {
        get: {
            handler: async ({ params }) => getSongById(params.id),
            description: 'Get song metadata',
        },
    },
    'musics/songs/onlinesearch': {
        get: {
            handler: async ({ query }) => [],
            description: 'Search a song online',
        },
    },
};

export default routes;
