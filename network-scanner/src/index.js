import { exec } from 'child_process';
import { networkInterfaces } from 'os';
import express from 'express';

let CACHE = [];
let CACHE_SUBNET = null;
let lastScan = 0;
let scanPromise = null;
let scanError = null;

const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes background refresh
const SCAN_TIMEOUT_MS = 30 * 1000;
const DEFAULT_SUBNET = '192.168.1';

function execAsync(command, timeout = SCAN_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        exec(command, { timeout }, (error, stdout, stderr) => {
            if (error) {
                error.stderr = stderr;
                return reject(error);
            }
            resolve(stdout);
        });
    });
}

function getSubnetFromInterfaces() {
    const interfaces = networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
            if (iface.family === 'IPv4' && !iface.internal) {
                const parts = iface.address.split('.');
                return parts.slice(0, 3).join('.');
            }
        }
    }
    return null;
}

function parseArpScanOutput(stdout, subnet) {
    const devices = {};
    // arp-scan output format:
    // 192.168.1.1    aa:bb:cc:dd:ee:ff    Vendor Name
    // 192.168.1.2    aa:bb:cc:dd:ee:ff    (Unknown)
    const lineRegex =
        /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-fA-F:]{17})/;

    for (const line of stdout.split('\n')) {
        const match = line.match(lineRegex);
        if (match) {
            const ip = match[1];
            const mac = match[2].toLowerCase();
            if (!subnet || ip.startsWith(subnet + '.')) {
                devices[mac] = ip;
            }
        }
    }
    return Object.entries(devices).map(([mac, ip]) => ({ mac, ip }));
}

// Parse the standard `arp -an` output as a fallback
function parseArpOutput(stdout, subnet) {
    const devices = {};
    // Linux: ? (192.168.1.1) at aa:bb:cc:dd:ee:ff [ether] on eth0
    // Windows: 192.168.1.1 aa-bb-cc-dd-ee-ff dynamic
    const arpRegex =
        /\(?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\)?\s+(?:at\s+|)([0-9a-fA-F:-]{17})/;

    for (const line of stdout.split('\n')) {
        const match = line.match(arpRegex);
        if (match) {
            const ip = match[1];
            // Normalize separators to colons and lowercase
            const mac = match[2].replace(/-/g, ':').toLowerCase();
            if (!subnet || ip.startsWith(subnet + '.')) {
                devices[mac] = ip;
            }
        }
    }
    return Object.entries(devices).map(([mac, ip]) => ({ mac, ip }));
}

async function performScan(subnet) {
    try {
        // arp-scan targets the local subnet by default; if a subnet is
        // supplied, use the subnet requested for the right /24 range.
        const command = subnet
            ? `arp-scan --subnet ${subnet}.0/24 2>/dev/null`
            : 'arp-scan --localnet 2>/dev/null';
        const stdout = await execAsync(command);
        const parsed = parseArpScanOutput(stdout, subnet);
        if (parsed.length) {
            CACHE = parsed;
            CACHE_SUBNET = subnet || null;
            lastScan = Date.now();
            scanError = null;
        }
    } catch (e) {
        scanError = e;
        // Fallback: read current ARP table (should have entries from arp-scan)
        try {
            const stdout = await execAsync('arp -an 2>/dev/null');
            const parsed = parseArpOutput(stdout, subnet);
            if (parsed.length) {
                CACHE = parsed;
                CACHE_SUBNET = subnet || null;
                lastScan = Date.now();
            }
        } catch (e2) {
            scanError = e2;
        }
    }
}

async function getNetworkDevices(subnet) {
    const targetSubnet = subnet || null;
    // If cache exists, is fresh, and matches the requested subnet, return it
    if (
        CACHE &&
        CACHE_SUBNET === targetSubnet &&
        Date.now() - lastScan < SCAN_INTERVAL_MS
    ) {
        return CACHE;
    }

    // If a scan is already in progress, wait for it
    if (scanPromise) {
        await scanPromise;
        return CACHE || [];
    }

    // Trigger a new scan
    scanPromise = performScan(targetSubnet).finally(() => {
        scanPromise = false;
    });
    await scanPromise;
    return CACHE || [];
}

async function startBackgroundScan() {
    const subnet = getSubnetFromInterfaces() || DEFAULT_SUBNET;
    // Initial scan at startup
    await getNetworkDevices(subnet);
    // Refresh periodically using the same guarded scan path
    setInterval(() => getNetworkDevices(subnet), SCAN_INTERVAL_MS);
}

const app = express();
app.use(express.json());

app.get('/api/devices', async (req, res) => {
    try {
        const s = (req.query?.subnet || DEFAULT_SUBNET)
            .toString()
            .replace(/\.$/, '');
        const devices = await getNetworkDevices(s);
        res.send(devices);
    } catch (e) {
        res.status(500).json({
            message: 'Network scan failed',
            error: e?.message,
        });
    }
});

// Triggers a scan on demand (useful for the orchestrator's IP rotation job)
app.post('/api/scan', async (req, res) => {
    try {
        const s = (req.body?.subnet || DEFAULT_SUBNET)
            .toString()
            .replace(/\.$/, '');
        CACHE = null; // force refresh
        const devices = await getNetworkDevices(s);
        res.send(devices);
    } catch (e) {
        res.status(500).json({
            message: 'Network scan failed',
            error: e?.message,
        });
    }
});

app.get('/api/cache', (req, res) => {
    res.send({
        devices: CACHE || [],
        lastScan: lastScan ? new Date(lastScan).toISOString() : null,
        error: scanError ? String(scanError) : null,
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Something went wrong!' });
});

app.get('/ping', (req, res) => res.send('pong'));

// Start the Express server
const port = 9306;
app.listen(port, '0.0.0.0', () => {
    console.log(`Http server listening on port ${port}`);
    startBackgroundScan();
});
