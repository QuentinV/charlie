import { cs } from '../core/db';
import { getNetworkDevices } from '../core/ipscan';
import { Provider } from '../types';

async function rotateProvidersIp() {
    try {
        const subnet = process.env.SUBNET_IP ?? '192.168.1.';
        const devices = await getNetworkDevices(subnet);

        const providers = await cs.providers.find().toArray();
        providers.forEach((p: Provider) => {
            if (!p.mac) return;
            const host = devices[p.mac.toLowerCase()];
            if (host) {
                cs.providers.updateOne({ _id: p._id }, { $set: { host } });
            }
        });
    } catch (e) {
        console.log(e);
    }
}

export async function setupRotateProvidersIp() {
    setInterval(rotateProvidersIp, 60000 * 60);
}
