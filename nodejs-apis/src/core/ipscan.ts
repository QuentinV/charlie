import { exec, ExecException } from 'child_process';
import 'dotenv/config';

const isWindows = process.platform === 'win32';
let CACHE = {};

function getRange(subnet: string, start: number, stop: number) {
    return [...Array(stop - start + 1)].map((v, i) => `${subnet}.${start + i}`);
}

export function getMacAddress(ip: string): string | undefined {
    return Object.entries(CACHE).find(([_, v]) => v === ip)?.[0];
}

interface DeviceMap {
    [mac: string]: string;
}

/**
 * Refreshes the ARP cache and extracts IP/MAC pairs
 * @param subnet The first three octets of the network (e.g., "192.168.1")
 */
export async function getNetworkDevices(subnet: string): Promise<DeviceMap> {
    const refreshCommand = `powershell -Command "1..255 | ForEach-Object { ping -n 1 -w 10 ${subnet}$_ } > $null"`;
    const arpCommand = `arp -a`;

    // refresh cache
    await new Promise<void>((res) => {
        exec(refreshCommand, () => res());
    });

    const map = await new Promise<DeviceMap>((resolve, reject) => {
        exec(arpCommand, (error: ExecException | null, stdout: string) => {
            if (error) {
                return reject(error);
            }

            const devices: DeviceMap = {};
            const lines: string[] = stdout.split('\n');

            // Regex: Captures IP in group 1 and MAC (with hyphens) in group 2
            const arpRegex =
                /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-fA-F-]{17})/;

            for (const line of lines) {
                const match = line.match(arpRegex);
                if (match) {
                    const ip = match[1];
                    const mac = match[2].replace(/-/g, ':').toLowerCase();

                    if (ip.startsWith(subnet)) {
                        devices[mac] = ip;
                    }
                }
            }

            resolve(devices);
        });
    });

    CACHE = map;

    return map;
}
