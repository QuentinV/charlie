import fs from 'fs';
import { pcmToWav } from './utils';
import path from 'path';
import { cs } from '../core/db';

const RECORDINGS_DIR = 'recordings';

// ensure directory exists
if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

export function saveWavWithRotation(pcmBuffer) {
    const wavBuffer = pcmToWav(pcmBuffer);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = path.join(RECORDINGS_DIR, `rec-${timestamp}.wav`);

    fs.writeFileSync(filepath, wavBuffer);

    rotateOldRecordings(RECORDINGS_DIR, 10);

    return filepath;
}

async function rotateOldRecordings(dir: string, maxFiles: number) {
    const files = fs.readdirSync(dir);
    const wavFiles = files.filter((f) => f.endsWith('.wav'));

    if (wavFiles.length <= maxFiles) return;

    // Get file stats to sort by creation time
    const filesWithStats = wavFiles.map((file) => {
        const fullPath = path.join(dir, file);
        const stats = fs.statSync(fullPath);
        return { file, fullPath, ctime: stats.ctime };
    });

    // Sort oldest → newest
    filesWithStats.sort((a, b) => a.ctime.getTime() - b.ctime.getTime());

    const toDelete = filesWithStats.slice(0, wavFiles.length - maxFiles);

    for (const f of toDelete) {
        fs.unlinkSync(f.fullPath);
    }
}

export async function logEcho(ip: string, message: string) {
    console.log(`[echo ${ip}] ${message}`);
    const a = {
        message,
        from: ip,
        type: 'echo',
        modified: new Date(),
    };
    await cs.activities.insertOne(a);
}
