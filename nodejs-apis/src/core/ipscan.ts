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
    // Windows uses PowerShell loop; Linux uses fping (fast) or a bash loop as fallback
    const refreshCommand = isWindows
        ? `powershell -Command "1..255 | ForEach-Object { ping -n 1 -w 10 ${subnet}$_ } > $null"`
        : `for i in {1..255}; do ping -c 1 -W 1 ${subnet}$i > /dev/null 2>&1 & done; wait`;

    const arpCommand = isWindows ? `arp -a` : `arp -an`;

    // Refresh cache
    await new Promise<void>((res) => {
        exec(refreshCommand, () => res());
    });

    const map = await new Promise<DeviceMap>((resolve, reject) => {
        exec(arpCommand, (error: ExecException | null, stdout: string) => {
            if (error) return reject(error);

            const devices: DeviceMap = {};
            const lines = stdout.split('\n');

            // Regex handles both Windows (192.168.1.1 ... 00-aa...)
            // and Linux ( (192.168.1.1) at 00:aa... )
            const arpRegex =
                /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}).*?([0-9a-fA-F:-]{17})/;

            for (const line of lines) {
                const match = line.match(arpRegex);
                if (match) {
                    const ip = match[1];
                    // Normalize separators to colons and lowercase
                    const mac = match[2].replace(/-/g, ':').toLowerCase();

                    if (ip.startsWith(subnet)) {
                        devices[mac] = ip;
                    }
                }
            }
            resolve(devices);
        });
    });

    return map;
}
