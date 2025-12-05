import dgram from 'dgram';
import { askDirect } from '../ai/ask';
import { stt } from './stt';
import { tts } from '../ai/tts';
import { send } from './client';
import { initAll } from '../init';

initAll();

// TODO do audio buffer by MAC address, reset after a timeout ?
let audioBuffer = [];
let timeout = null;
function resetTimeout({ ip }) {
    clearTimeout(timeout);
    timeout = setTimeout(async () => {
        try {
            console.log('audio received');
            const text = await stt(audioBuffer);
            console.log('spoken text', text);
            //const result = await askDirect(text);
            //console.log('result', result);
            const resultAudio = await tts({ text });
            await send({ ip, buffer: Buffer.from(resultAudio) });
        } catch (e) {
            console.log(e);
        } finally {
            audioBuffer = [];
        }
    }, 1000);
}

// UDP Server for audio
const PORT_UDP_AUDIO = 12345;
const audioServer = dgram.createSocket('udp4');
audioServer.on('message', async (data, rinfo) => {
    console.log(
        `receving audio from ${rinfo.address}:${rinfo.port} of size ${rinfo.size}`
    );
    resetTimeout({ ip: rinfo.address });
    audioBuffer.push(data);
});

audioServer.on('listening', () => {
    console.log(`Listening audio data on port ${PORT_UDP_AUDIO}`);
});

audioServer.bind(PORT_UDP_AUDIO);
