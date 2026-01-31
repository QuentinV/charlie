import { z } from 'zod';
import {
    audioPlayer,
    executeCommand,
    searchLibrary,
} from '../../../musics/service';
import { Tools } from '../../../types';

export const tools: Tools = {
    'control-music': {
        description:
            'Play/Stop/Pause/Resume/Skip musics. Song id is required only for play command.',
        inputSchema: {
            command: z.enum([
                'play',
                'stop',
                'resume',
                'pause',
                'increaseVolume',
                'decreaseVolume',
                'skip',
            ]),
            songId: z.optional(z.number()),
        },
        exec: async ({ command, songId }) => {
            if (!audioPlayer[command]) return 'Unkwown command';
            try {
                await executeCommand({ command, songId });
                return 'Done';
            } catch (e) {
                return 'Error';
            }
        },
    },
    'search-music': {
        description: 'Search music by term and return id.',
        inputSchema: { term: z.string() },
        exec: async ({ term }) => {
            const songs = await searchLibrary({ q: term });
            const filteredSongs = songs
                .slice(0, 5)
                .map((it: any) => `- ${it.id}: ${it.name}`);
            return filteredSongs.length === 0
                ? 'Found no sounds'
                : (filteredSongs.length > 1
                      ? `Assistant should pick the most interesting song: `
                      : '') + filteredSongs.join('\n');
        },
    },
};

export default tools;
