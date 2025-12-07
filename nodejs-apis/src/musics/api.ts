import { cs } from '../core/db';
import { RestApis } from '../types';
import { v4 as uuidV4 } from 'uuid';
import { getPlaylistById, searchAlbums } from './service';

const routes: RestApis = {
    'musics/playlists': {
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
    'musics/playlist/:pid/songs/:sid': {
        post: {
            handler: async ({ params }) => {
                const playlist = await getPlaylistById(params.pid);
                playlist.songs.push(params.sid);
                await cs.musics_playlists.updateOne(
                    { _id: params.id },
                    { $set: { songs: playlist.songs } }
                );
            },
            description: 'Add a song to a playlist',
        },
        delete: {
            handler: async ({ params }) => {
                const playlist = await getPlaylistById(params.pid);
                await cs.musics_playlists.updateOne(
                    { _id: params.id },
                    {
                        $set: {
                            songs: playlist.songs.filter(
                                (s) => s !== params.sid
                            ),
                        },
                    }
                );
            },
            description: 'Delete a song from a playlist',
        },
    },
    musics: {
        get: {
            handler: async ({ query }) => searchAlbums(query),
            description: 'Search musics from albums',
        },
    },
    'musics/:id/stream': {
        get: {
            handler: async ({ params }) => ({
                res: true,
            }),
            description: 'Stream a music',
        },
    },
    'musics/:id': {
        get: {
            handler: async ({ params }) => ({
                res: true,
            }),
            description: 'Get music metadata',
        },
    },
};

export default routes;
