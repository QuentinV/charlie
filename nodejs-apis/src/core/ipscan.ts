import 'dotenv/config';

type DevicesMac = { mac: string; ip: string }[];
let CACHE: DevicesMac = [];

export function getMacAddress(ip: string): string | undefined {
    return CACHE.find((d) => d.ip === ip)?.mac;
}

export async function getNetworkDevices(subnet: string): Promise<DevicesMac> {
    CACHE = await (
        await fetch(`http://localhost:9306/api/devices?subnet=${subnet}`)
    ).json();
    return CACHE;
}
