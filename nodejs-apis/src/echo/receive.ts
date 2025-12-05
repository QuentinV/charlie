import { cs } from '../core/db';
import Aedes from 'aedes';
import net from 'net';
import mqtt from 'mqtt';
import { initAll } from '../init';

initAll();

const subscribers = {
    'echo/status': async (data: string) => {
        const [mac, temp, hum, motion] = data.split(';');

        const provider = await cs.providers.findOne(
            { mac },
            { projection: { _id: 1 } }
        );
        if (!provider) return;

        const device = await cs.devices.findOne(
            { provider: provider._id },
            { projection: { _id: 1, name: 1 } }
        );
        if (!device) return;

        const state: any = {
            device: device._id,
            provider: provider._id,
            mac,
            deviceName: device.name,
            timestamp: Date.now(),
            temperature: parseFloat(temp),
            humidity: parseFloat(hum),
        };

        if (motion) {
            state.motionsensor = motion === '1';
        }

        await cs.states.insertOne(state);
    },
};

const aedes = new Aedes();
const server = net.createServer(aedes.handle);

server.listen(1883, function () {
    console.log('MQTT broker started on port 1883');
});

const mqttClient = mqtt.connect(`mqtt://localhost:1883`);
mqttClient.on('connect', () => {
    console.log('MQTT client connected to broker');
    Object.keys(subscribers).forEach((s) => {
        mqttClient.subscribe(s);
        console.log(`[MQTT] subscribe to ${s}`);
    });
});

mqttClient.on('message', async (topic, message) => {
    console.log(`Received on ${topic}: ${message.toString()}`);
    subscribers[topic]?.(message.toString());
});
