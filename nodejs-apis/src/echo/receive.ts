import { cs } from '../core/db';
import Aedes from 'aedes';
import net from 'net';
import mqtt from 'mqtt';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';

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

export function setupEchoReceiver() {
    const aedes = new Aedes();
    const server = net.createServer(aedes.handle);

    const mqttPort = 9304;
    server.listen(mqttPort, function () {
        console.log('[ECHO] MQTT broker started on port ' + mqttPort);
    });

    const mqttClient = mqtt.connect(`mqtt://localhost:` + mqttPort);
    mqttClient.on('connect', () => {
        console.log('[ECHO] MQTT client connected to broker');
        Object.keys(subscribers).forEach((s) => {
            mqttClient.subscribe(s);
            console.log(`[ECHO MQTT] subscribe to ${s}`);
        });
    });

    mqttClient.on('message', async (topic, message) => {
        console.log(`[ECHO MQTT]Received on ${topic}: ${message.toString()}`);
        subscribers[topic]?.(message.toString());
    });
}


/*
TODO Camera

function processFeed() {
    // Replace with your ESP32 stream URL
    const esp32Url = 'http://192.168.1.23/stream';

    // Spawn ffmpeg process
    const ffmpeg = spawn(
        ffmpegPath,
        [
            '-reconnect',
            '1',
            '-reconnect_streamed',
            '1',
            '-reconnect_delay_max',
            '2',
            '-fflags',
            '+genpts',
            '-t',
            '10',
            '-i',
            esp32Url,
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '23',
            'output.mp4',
        ] 
    );

    // Handle stdout (video data chunks)
    //ffmpeg.stdout.on('data', (chunk) => {
    //    console.log('Got video data chunk:', chunk.length);
    // You can forward this chunk to WebSocket clients, save to file, etc.
    //});

    // Handle stderr (FFmpeg logs)
    ffmpeg.stderr.on('data', (data) => {
        console.error('FFmpeg log:', data.toString());
    });

    // Handle process exit
    ffmpeg.on('close', (code) => {
        console.log(`FFmpeg exited with code ${code}`);
    });
}

processFeed();*/

/*[
        '-reconnect',
        '1',
        '-reconnect_streamed',
        '1',
        '-reconnect_delay_max',
        '2',
        '-fflags',
        '+genpts',
        '-t',
        '10',
        '-i',
        esp32Url, // input: ESP32 MJPEG stream
        '-c:v',
        'libx264', // re-encode to H.264
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-f',
        'hls', // output format: HLS
        '-hls_time',
        '2', // 2s segments
        '-hls_list_size',
        '5', // keep last 5 segments
        '-hls_flags',
        'delete_segments',
        './stream.m3u8', // output playlist + segments
    ]*/
