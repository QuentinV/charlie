import net from 'net';

const PORT = 12345;

export function send({ ip, buffer }: { ip: string; buffer: Uint8Array }) {
    return new Promise((res, rej) => {
        const client = new net.Socket();

        client.connect(PORT, ip, () => {
            console.log(`[${ip}:${PORT}]🔌 Connected`);
            client.write(buffer);
            client.end();
        });

        client.on('close', () => {
            console.log(`[${ip}:${PORT}] ✅ Connection closed`);
            res(undefined);
        });

        client.on('error', (err) => {
            console.log(`[${ip}:${PORT}] ❌ TCP Error:`, err.message);
            rej();
        });
    });
}
