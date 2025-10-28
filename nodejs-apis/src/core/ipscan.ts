import { exec } from 'child_process';
import 'dotenv/config';

const isWindows = process.platform === 'win32';

interface Device {
    macInfo: MacVendorInfo;
    mac: string;
    ip: string;
}

interface MacVendorInfo {
    macPrefix?: string;
    country?: string;
    company: string;
    address?: string;
    updated?: string;
    isPrivate?: boolean;
    isRand?: boolean;
}

function getRange(subnet, start, stop) {
    return [...Array(stop - start + 1)].map((v, i) => `${subnet}.${start + i}`);
}

async function getVendor(mac): Promise<MacVendorInfo> {
    const res = await fetch(`https://api.macvendors.com/${mac}`);
    const company = await res.text();
    return {
        company,
    };
}

async function maclookup(mac): Promise<MacVendorInfo | undefined> {
    const apiKey = process.env.MACVENDORS_APIKEY;
    if (!apiKey) return;
    const res = await fetch(
        `https://api.maclookup.app/v2/macs/${mac}?apiKey=${apiKey}`
    );
    const json: any = await res.json();
    if (json?.success && json?.found) {
        return json;
    }
}

async function getMacAddress(ip: string): Promise<string> {
    return new Promise((res, rej) => {
        exec(
            isWindows ? `arp -a ${ip}` : `arp -n ${ip}`,
            async (err, stdout) => {
                if (err) {
                    rej(err);
                    return;
                }
                res(
                    stdout.match(
                        /(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/g
                    )?.[0]
                );
            }
        );
    });
}

const latencyRegex = /(time|temps)[=<]?(\d+\.?\d*)\s*ms/;

interface PingResponse {
    ip: string;
    alive: boolean;
    latency?: number;
}

export async function pingStatus(ip: string) {
    const cmd = isWindows ? `ping -n 1 ${ip}` : `ping -c 1 ${ip}`;
    return new Promise((res, rej) => {
        exec(cmd, (err, stdout) => {
            const output = stdout.toString();
            const alive =
                !err &&
                !output.includes('Destination host unreachable') &&
                !output.includes('Impossible de joindre');

            const obj: PingResponse = { alive, ip };

            if (alive) {
                const latencyMatch = output.match(latencyRegex);
                const latency = latencyMatch ? latencyMatch[2] : null;
                obj.latency = parseInt(latency);
            }

            res(obj);
        });
    });
}

export async function scanNetworkForDevices() {
    const subnet = process.env.SUBNET_IP;
    if (!subnet) return [];
    const aliveIps = (
        await Promise.allSettled(
            getRange(subnet, 1, 255).map((ip) => pingStatus(ip))
        )
    )
        .filter((p: any) => p?.value?.alive)
        .map((p: any) => p.value.ip);

    const devices: Device[] = [];
    for (let i = 0; i < aliveIps.length; ++i) {
        const mac = await getMacAddress(aliveIps[i]);
        if (!mac) continue;
        const macInfo = await maclookup(mac);
        if (!macInfo) continue;
        devices.push({ macInfo, ip: aliveIps[i], mac });
    }

    return devices;
}
