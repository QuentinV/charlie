import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { cs } from '../core/db';
import { spawn } from 'child_process';

function getFilesRecursive(dir: string, exts: string[]): string[] {
    const fileList: string[] = [];

    function walk(currentDir: string) {
        const files = fs.readdirSync(currentDir);

        for (const file of files) {
            const fullPath = path.join(currentDir, file);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                walk(fullPath);
            } else {
                if (exts.includes(path.extname(file).toLowerCase())) {
                    fileList.push(fullPath);
                }
            }
        }
    }

    walk(dir);
    return fileList;
}

const musicDir = process.env.MUSICS_DIR + '/';

function fetchAllMusicsFiles() {
    const extensions = ['.mp3', '.flac'];
    let i = 0;

    const songsByPaths = {};
    const songsById = {};

    const files = getFilesRecursive(musicDir, extensions);
    for (let i = 0; i < files.length; ++i) {
        let v = files[i];

        const path = v.replace(musicDir, '');
        const labels = path
            .substring(0, path.lastIndexOf('.'))
            .split('/')
            .filter((s) => !!s.trim());

        const song = {
            path,
            labels,
            name: labels.join('_'),
            id: i++,
        };

        songsByPaths[song.path] = song;
        songsById[song.id] = song;
    }

    return { songsById, songsByPaths };
}

export const { songsById, songsByPaths } = process.env.MUSICS_DIR
    ? fetchAllMusicsFiles()
    : {};

interface CompleteSong extends Song {
    labels: string[];
}

interface Song {
    id: number;
    path: string;
    name: string;
}

interface Playlist {
    name: string;
    songs: Song[];
}

export async function getSongById(id: string): Promise<CompleteSong> {
    return songsById[id];
}

export async function getPlaylistById(id: string): Promise<Playlist> {
    const playlist = await cs.musics_playlists.findOne({ _id: id });
    playlist.songs = playlist?.songs?.map((s: string) => ({
        id: songsByPaths[s]?.id,
        path: s,
        name: songsByPaths[s]?.name,
    }));
    return playlist;
}

export async function searchLibrary({ q }: { q: string }) {
    q = q?.trim()?.toLowerCase();
    if (!q) return;
    return Object.values(songsById).filter(
        (v: any) => v.name.toLowerCase().indexOf(q) !== -1
    );
}

interface StreamMusicRes {
    stream: any;
    size: number;
    type: string;
    range?: string;
}

export async function streamMusic(
    id: string,
    range: string
): Promise<StreamMusicRes> {
    const song = await getSongById(id);
    const path = musicDir + song.path;
    const stats = fs.statSync(path);

    const res: any = {
        type: song.path.endsWith('.flac') ? 'audio/flac' : 'audio/mpeg',
    };

    if (!range) {
        res.size = stats.size;
        res.stream = fs.createReadStream(path);
        return res;
    }

    // Parse Range header: e.g. "bytes=12345-"
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;

    res.stream = fs.createReadStream(path, { start, end });
    res.size = end - start + 1;
    res.range = `bytes ${start}-${end}/${stats.size}`;
    return res;
}

class AudioPlayer {
    currentPlayer: any;
    time: number;
    timer: any;
    volume: number;

    constructor() {
        this.currentPlayer = null;
    }

    async play(id: string, volume = 100, offset = 0) {
        this.volume = volume;
        this.timer = null;

        this.stop();

        const song = await getSongById(id);
        if (!song?.path) {
            return;
        }
        const path = musicDir + song.path;

        this.currentPlayer = spawn('ffplay', ['-nodisp', '-autoexit', path], {
            stdio: 'inherit',
        });

        const args = ['-nodisp', '-autoexit', '-volume', String(volume)];
        if (offset > 0) {
            args.push('-ss', String(offset));
        }
        args.push(path);

        this.currentPlayer = spawn('ffplay', args, {
            stdio: ['ignore', 'inherit', 'inherit'],
            detached: true,
        });

        this.toggleTimer();
    }

    toggleTimer(state?: boolean) {
        if (state === undefined) {
            state = !this.timer;
        }

        console.log('toggleTimer', state);
        if (state) {
            this.timer = setInterval(() => {
                this.time = this.time + 1;
            }, 1000);
        } else {
            this.timer && clearInterval(this.timer);
            this.timer = null;
        }
    }

    stop() {
        if (this.currentPlayer) {
            console.log('stop');
            process.kill(this.currentPlayer.pid, 'SIGTERM');
            this.currentPlayer = null;
            this.time = 0;
            this.toggleTimer(false);
        }
    }

    pauseResume() {
        if (this.currentPlayer) {
            console.log('pauseResume');
            this.currentPlayer.stdin.write('p');
            this.toggleTimer();
        }
    }

    volumeUp() {
        if (this.currentPlayer) {
            console.log('volumeUp');
            this.currentPlayer.stdin.write('+');
            this.volume = Math.min(this.volume + 5, 100);
        }
    }

    volumeDown() {
        if (this.currentPlayer) {
            console.log('volumeDown');
            this.currentPlayer.stdin.write('-');
            this.volume = Math.max(this.volume - 5, 0);
        }
    }

    seekForward10s() {
        if (this.currentPlayer) {
            console.log('seekForward10s');
            this.currentPlayer.stdin.write('\x1b[C'); // Right arrow
            this.time = this.time + 10;
        }
    }

    seekBack10s() {
        if (this.currentPlayer) {
            console.log('seekBack10s');
            this.currentPlayer.stdin.write('\x1b[D'); // Left arrow
            this.time = this.time - 10;
        }
    }

    status() {
        return {
            isPlaying: this.timer !== null,
            volume: this.volume,
            time: this.time,
        };
    }
}

export const audioPlayer = new AudioPlayer();
