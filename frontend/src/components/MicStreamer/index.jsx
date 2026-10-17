import React, { useRef, useState } from 'react';

export const MicStreamer = () => {
    const [isStreaming, setIsStreaming] = useState(false);
    const wsRef = useRef(null);
    const audioContextRef = useRef(null);
    const workletNodeRef = useRef(null);
    const streamRef = useRef(null);

    const SERVER_URL = 'wss://your-server.example.com/audio';

    const startStreaming = async () => {
        if (isStreaming) return;

        // 1. Open WebSocket
        wsRef.current = new WebSocket(SERVER_URL);
        wsRef.current.binaryType = 'arraybuffer';

        wsRef.current.onopen = async () => {
            // 2. Get microphone
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
            });
            streamRef.current = stream;

            // 3. Create AudioContext
            const audioContext = new AudioContext({ sampleRate: 16000 });
            audioContextRef.current = audioContext;

            // 4. Load AudioWorklet
            await audioContext.audioWorklet.addModule(
                '/audio-worklet-processor.js'
            );

            // 5. Create WorkletNode
            const workletNode = new AudioWorkletNode(
                audioContext,
                'pcm-worklet'
            );
            workletNodeRef.current = workletNode;

            // 6. Connect mic → worklet
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(workletNode);

            // 7. Receive PCM chunks from worklet
            workletNode.port.onmessage = (event) => {
                if (wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(event.data);
                }
            };

            // Tell worklet WebSocket is open
            workletNode.port.postMessage({ wsOpen: true });

            setIsStreaming(true);
        };
    };

    const stopStreaming = () => {
        setIsStreaming(false);

        if (workletNodeRef.current) {
            workletNodeRef.current.port.postMessage({ wsOpen: false });
            workletNodeRef.current.disconnect();
        }

        if (audioContextRef.current) {
            audioContextRef.current.close();
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
        }

        if (wsRef.current) {
            wsRef.current.close();
        }
    };

    return (
        <div>
            <button onClick={startStreaming} disabled={isStreaming}>
                Start Streaming
            </button>
            <button onClick={stopStreaming} disabled={!isStreaming}>
                Stop Streaming
            </button>
            <p>Status: {isStreaming ? 'Streaming…' : 'Stopped'}</p>
        </div>
    );
};
