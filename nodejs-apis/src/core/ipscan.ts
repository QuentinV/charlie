import { exec } from 'child_process';
import createMDNSServer from 'mdns-server';
import 'dotenv/config';
import dnssd, { ServiceType } from 'dnssd';

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

export async function getMacAddress(ip: string): Promise<string> {
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

export async function getIpsFromMacs(
    macs: string[]
): Promise<{ [key: string]: string } | null> {
    await Promise.allSettled(
        [...Array(254)].map(
            (v, i) =>
                new Promise((res, rej) =>
                    exec(`ping -c 1 -W 1 192.168.1.${i}`, (err) => {
                        console.log(`192.168.1.${i}`);
                        err ? rej() : res(undefined);
                    })
                )
        )
    );

    return new Promise((resolve, reject) => {
        const normalizedMacs = macs.map((mac) =>
            mac.toLowerCase().replace(/:/g, '-')
        );
        console.log(normalizedMacs);

        const found = {};
        const cmd = isWindows ? 'arp -a' : 'arp -n';

        exec(cmd, (err, stdout) => {
            if (err) {
                reject(err);
                return;
            }

            const lines = stdout.split('\n');
            //console.log('lines', lines);
            for (const line of lines) {
                const macMatch = line.match(/\b\w{1,2}(?:-\w{1,2}){5}\b/);
                if (!macMatch) continue;
                const mac = macMatch[0];
                console.log('MAC', mac, normalizedMacs.includes(mac));
                if (normalizedMacs.includes(mac)) {
                    const ipMatch = line.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
                    if (ipMatch) {
                        found[mac] = ipMatch[0];
                    }
                }
            }

            resolve(Object.keys(found).length ? found : null);
        });
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

/*
const client = new Client();

client.on('response', (headers, statusCode, rinfo) => {
    console.log(`📡 SSDP: ${headers.ST} at ${rinfo.address}`);
});
client.search('ssdp:all');
*/
// Discover all advertised services
/*
const browser = new dnssd.Browser(
    new dnssd.ServiceType('_services._dns-sd._udp')
);

browser.on('serviceUp', (service) => {
    console.log(`🟢 Found mDNS service: ${service.name}`);
    console.log(`  Type: ${service.type}`);
    console.log(`  Host: ${service.host}`);
    console.log(`  IP: ${service.addresses?.join(', ')}`);
    console.log(`  Port: ${service.port}`);
});

browser.start();
*/
/*
const browser = mdns.createBrowser(mdns.tcp('http'));
browser.on('serviceUp', (service) => {
    console.log('🟢 Found:', service.name);
    console.log('  Host:', service.host);
    console.log('  IP:', service.addresses);
});
browser.start();
*/

/*
const bonjour = new Bonjour();

const browser = bonjour.find({ type: 'hap' }); // HomeKit devices

browser.on('up', (service) => {
    console.log(`🟢 Found: ${service.name}`);
    console.log(`  Host: ${service.host}`);
    console.log(`  IPs: ${service.addresses}`);
    console.log(`  Port: ${service.port}`);
});
*/

async function discoverAll() {
    return new Promise((resolve) => {
        const promises = [];
        const browser = new dnssd.Browser(dnssd.all());
        browser.on('serviceUp', (service) => {
            promises.push(
                new Promise((r) => {
                    const b = new dnssd.Browser(
                        ServiceType[service.protocol](service.name)
                    );
                    //b.on('serviceUp', ({ fullname, name, type, host, port, addresses }) => {
                    //console.log({ fullname, name, type, host, port, addresses });
                    //});
                    b.start();
                    setTimeout(() => r(b.list()), 15000);
                })
            );
        });

        browser.start();

        setTimeout(async () => {
            const res = await Promise.allSettled(promises);
            resolve(
                res.flatMap((r: any) => {
                    return r.value.map(
                        ({ fullname, name, type, host, port, addresses }) => {
                            return {
                                fullname,
                                name,
                                type,
                                host,
                                port,
                                addresses,
                            };
                        }
                    );
                })
            );
        }, 20000);
    });
}
