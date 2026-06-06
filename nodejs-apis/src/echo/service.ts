import { connectedEchos } from './listen';

async function sendToConnectedEchos(ip: string, object: any) {
    await connectedEchos[ip]?.send(JSON.stringify(object));
}

export async function setWakeUpWordAccuracy(
    ip: string,
    wakeWordAccuracy: number
) {
    await sendToConnectedEchos(ip, {
        c: 'setWakeUpWordAccuracy',
        v: wakeWordAccuracy,
    });
}

export async function setServerIp(ip: string, serverIp: string) {
    await sendToConnectedEchos(ip, {
        c: 'setServerIp',
        v: serverIp,
    });
}

export async function startOTA(ip: string) {
    await sendToConnectedEchos(ip, { c: 'OTA' });
}

interface UpdateDisplayRequest {
    k: number; // screen key
    texts: {
        ts?: number; // text size, default 1
        v: string; // text
        cx?: number; // cursor x
        cy?: number; // cursor y
        r?: number; // rotation
    }[];
}

export async function updateDisplays(
    ip: string,
    requests: UpdateDisplayRequest[]
) {
    await sendToConnectedEchos(ip, { c: 'updateDisplays', v: requests });
}
