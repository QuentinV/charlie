import { exec } from 'child_process';
import express from 'express';

export async function getNetworkDevices(subnet) {
    const refreshCommand = `for i in {1..255}; do ping -c 1 -W 1 ${subnet}$i > /dev/null 2>&1 & done; wait`;

    // Refresh cache
    await new Promise((res) => {
        exec(refreshCommand, () => res());
    });

    return new Promise((resolve, reject) => {
        exec(`arp -an`, (error, stdout) => {
            if (error) return reject(error);

            const devices = {};
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
            resolve(Object.entries(devices).map(([mac, ip]) => ({ mac, ip })));
        });
    });
}

const app = express();
app.use(express.json());

app.get('/api/devices', async (req, res) => {
    console.log('/api/devices');
    const s = req.query?.subnet ?? '192.168.1';
    const subnet = s + '.';
    res.send(await getNetworkDevices(subnet));
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
});
