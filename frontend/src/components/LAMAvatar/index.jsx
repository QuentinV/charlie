import React, { useEffect, useRef } from 'react';
import * as GaussianSplats3D from 'gaussian-splat-renderer-for-lam';

export function LAMAvatar() {
    const containerRef = useRef();

    useEffect(() => {
        if (!containerRef?.current) return;
        let renderInstance;

        async function initRenderer() {
            const assetPath = '/asset/arkit/p2-1.zip'; // adjust path as needed
            /*renderInstance =
                await GaussianSplats3D.GaussianSplatRenderer.getInstance(
                    containerRef.current,
                    assetPath
                );*/
        }

        async function initMic() {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
            });
            const audioCtx = new AudioContext();
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            function animateExpression() {
                analyser.getByteFrequencyData(dataArray);
                const volume =
                    dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

                // Map volume to a simple mouth-open expression
                const expression = {
                    jawOpen: Math.min(volume / 100, 1),
                    eyeBlinkLeft: 0,
                    eyeBlinkRight: 0,
                    mouthSmileLeft: 0.2,
                    mouthSmileRight: 0.2,
                };

                if (renderInstance) {
                    renderInstance.updateExpression(expression);
                }

                requestAnimationFrame(animateExpression);
            }

            animateExpression();
        }

        initRenderer();
        initMic();

        return () => {
            if (renderInstance) renderInstance.dispose();
        };
    }, []);

    return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
