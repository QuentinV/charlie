import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { cs } from '../core/db';

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

function fetchAllMusicsFiles() {
    const musicDir = process.env.MUSICS_DIR + '\\';
    const extensions = ['.mp3', '.flac'];
    const allMusicFiles = getFilesRecursive(musicDir, extensions).reduce(
        (prev, v) => {
            v = v.substring(0, v.lastIndexOf('.'));
            const path = v.replace(musicDir, '');
            const labels = path.split('\\').filter((s) => !!s.trim());
            prev[path] = {
                path,
                labels,
                name: labels.join('_'),
            };
            return prev;
        },
        {}
    );
    return allMusicFiles;
}

const MUSICS = process.env.MUSICS_DIR ? fetchAllMusicsFiles() : null;

interface Song {
    file: string;
    name: string;
}

interface Playlist {
    name: string;
    songs: Song[];
}

export async function getPlaylistById(id: string): Promise<Playlist> {
    const playlist = await cs.musics_playlists.findOne({ _id: id });
    playlist.songs = playlist.songs.map((s: string) => ({
        file: s,
        name: MUSICS[s]?.name,
    }));
    return playlist;
}

export async function searchAlbums({ q }: { q: string }) {
    q = q?.trim()?.toLowerCase();
    if (!q) return;
    return Object.values(MUSICS).filter(
        (v: any) => v.name.toLowerCase().indexOf(q) !== -1
    );
}
