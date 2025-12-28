import 'dotenv/config';
import fs from 'fs';
import pathLib from 'path';
import { cs } from '../core/db';
import { spawn } from 'child_process';
import { NotFoundError } from '../errors';
import Fuse from 'fuse.js';

function getFilesRecursive(dir: string, exts: string[]): string[] {
    const fileList: string[] = [];

    function walk(currentDir: string) {
        const files = fs.readdirSync(currentDir);

        for (const file of files) {
            const fullPath = pathLib.join(currentDir, file);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                walk(fullPath);
            } else {
                if (exts.includes(pathLib.extname(file).toLowerCase())) {
                    fileList.push(fullPath);
                }
            }
        }
    }

    walk(dir);
    return fileList;
}

const musicDir = process.env.MUSICS_DIR;

function fetchAllMusicsFiles() {
    const extensions = ['.mp3', '.flac'];
    let i = 0;

    const songsByPaths = {};
    const songsById = {};

    const files = getFilesRecursive(musicDir, extensions);
    for (let i = 0; i < files.length; ++i) {
        let v = files[i];

        const delimiter = v.indexOf('/') !== -1 ? '/' : '\\';
        const path = v.replace(musicDir + delimiter, '');
        const labels = path
            .substring(0, path.lastIndexOf('.'))
            .split(delimiter)
            .filter((s) => !!s.trim());

        const song = {
            path,
            labels,
            name: labels.join(' '),
            id: i,
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

const songsFuse = new Fuse(Object.values(songsById), {
    keys: ['name'],
    threshold: 0.3, // lower = stricter
});

export async function searchLibrary({
    q,
}: {
    q: string;
}): Promise<CompleteSong[]> {
    q = q?.trim();
    if (!q) return;
    return songsFuse.search(q).map((result) => result.item as CompleteSong);
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
    const path = pathLib.join(musicDir, song.path);
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
    vol: number;
    song: CompleteSong;

    constructor() {
        this.currentPlayer = null;
        this.timer = null;
        this.vol = 50;
    }

    play({
        song,
        volume,
        offset,
    }: {
        song?: CompleteSong;
        volume?: number;
        offset?: number;
    }) {
        this.vol = volume ?? this.vol;
        this.stop();

        if (!song) {
            return;
        }

        const fullPath = pathLib.join(musicDir, song.path);
        this.song = song;
        this.time = 0;

        const args = ['-nodisp', '-autoexit', '-volume', String(this.vol)];
        if ((offset ?? 0) > 0) {
            args.push('-ss', String(offset));
            this.time = offset;
        }
        args.push(fullPath);

        this.currentPlayer = spawn('ffplay', args, {
            stdio: 'ignore',
        });

        this.currentPlayer.on('exit', () => {
            if (!this.timer) return;
            setTimeout(() => this.skip(), 2000);
        });

        this.toggleTimer();
    }

    toggleTimer(state?: boolean) {
        if (state === undefined) {
            state = !this.timer;
        }
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
        if (!this.currentPlayer) return;
        this.toggleTimer(false);
        try {
            process.kill(this.currentPlayer.pid, 'SIGTERM');
        } catch (e) {
            //
        }
        this.currentPlayer = null;
    }

    pause() {
        if (!this.currentPlayer) return;
        this.stop();
    }

    resume() {
        if (this.currentPlayer) return;
        this.play({
            song: this.song,
            volume: this.vol,
            offset: this.time,
        });
    }

    volume(volume: number) {
        if (!this.currentPlayer) return;
        this.play({
            song: this.song,
            volume: volume > 100 ? 100 : volume < 0 ? 0 : volume,
            offset: this.time,
        });
    }

    increaseVolume() {
        this.volume(this.vol + 10);
    }

    decreaseVolume() {
        console.log('volume', this.vol);
        this.volume(this.vol - 10);
    }

    seek(offset: number) {
        if (!this.currentPlayer) return;
        this.play({
            song: this.song,
            volume: this.vol,
            offset,
        });
    }

    async skip() {
        // Fetch random song from same artist
        const songs = await searchLibrary({
            q: this.song.labels?.[0] ?? this.song.name,
        });
        const song = songs[Math.floor(Math.random() * songs.length)];
        this.play({ song });
    }

    status() {
        return {
            isPlaying: this.timer !== null,
            volume: this.vol,
            time: this.time,
            song: this.song,
        };
    }
}

export const audioPlayer = new AudioPlayer();

export async function executeCommand({
    command,
    volume,
    offset,
    songId,
}: {
    command: string;
    volume?: number;
    offset?: number;
    songId?: string;
}) {
    if (command === 'play') {
        const song = await getSongById(songId);
        if (!song) {
            throw new NotFoundError();
        }
        audioPlayer.play({
            song,
            volume,
            offset,
        });
    } else if (command === 'seek') {
        audioPlayer.seek(offset);
    } else if (command === 'volume') {
        audioPlayer.volume(volume);
    } else {
        audioPlayer[command]?.();
    }
}

export async function manageSongsPlaylist(
    playlistId: string,
    songId: string,
    addSong: boolean
) {
    const playlist = await cs.musics_playlists.findOne({
        _id: playlistId,
    });
    if (!playlist) throw new NotFoundError('playlist not found');

    const song = await getSongById(songId);
    if (!song) throw new NotFoundError('song not found');

    const songsPaths = [...playlist.songs?.filter((p) => song.path !== p)];
    if (addSong) {
        songsPaths.push(song.path);
    }

    await cs.musics_playlists.updateOne(
        { _id: playlistId },
        { $set: { songs: songsPaths } }
    );
}
