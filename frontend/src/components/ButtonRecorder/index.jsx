import React, { useCallback, useState } from 'react';

export const ButtonRecorder = () => {
    const [texts, setTexts] = useState([]);

    const startRecording = useCallback(async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
        });
        const audioContext = new (window.AudioContext ||
            window.webkitAudioContext)();
        const input = audioContext.createMediaStreamSource(stream);

        const recorder = new Recorder(input, {
            numChannels: 1,
        });

        const socket = new WebSocket('ws://localhost:8080');

        socket.onopen = () => {
            recorder.record();

            // Stream audio every second
            setInterval(() => {
                recorder.exportWAV((blob) => {
                    blob.arrayBuffer().then((buffer) => {
                        if (socket.readyState === WebSocket.OPEN) {
                            socket.send(buffer);
                        }
                    });
                    recorder.clear(); // reset buffer
                });
            }, 1000);
            /*
            recorder.stop();
            socket.close();
            audioContext.close();
            */
        };
        socket.addEventListener('message', (message) => {
            if (message?.data) {
                const data = JSON.parse(message.data);
                if (data.text) {
                    console.log(texts, data.text);
                    setTexts([...texts, data.text]);
                }
            }
        });
    }, []);
    return (
        <>
            <button onClick={startRecording}>Start recording</button>
            {texts.map((t) => (
                <div>{t}</div>
            ))}
        </>
    );
};
