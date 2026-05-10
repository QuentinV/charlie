import { cs } from '../core/db';
import { getMacAddress } from '../core/ipscan';
import { RestApis } from '../types';
import { v4 as uuidV4 } from 'uuid';

const routes: RestApis = {
    'providers/:id': {
        get: async () => {},
        delete: async () => {},
    },
    providers: {
        get: async () => cs.providers.find().toArray(),
        post: async ({ body }) => {
            const {
                _id,
                name,
                host,
                user,
                mac,
                password,
                codesource,
                multidevices,
            } = body;
            const uuid = _id || uuidV4();

            let macAddress = mac;
            if (!macAddress && host?.startsWith('192.168.')) {
                try {
                    macAddress = getMacAddress(host);
                } catch (e) {
                    console.log(e);
                }
            }

            await cs.providers.updateOne(
                { _id: uuid },
                {
                    $set: {
                        _id: uuid,
                        name,
                        host,
                        user,
                        mac: macAddress,
                        password,
                        codesource,
                        multidevices,
                    },
                },
                { upsert: true }
            );
            return { uuid };
        },
    },
};

export default routes;
