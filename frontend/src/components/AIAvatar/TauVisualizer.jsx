import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import fragmentShader from './tauFragment.glsl?raw';
import vertexShader from './tauVertex.glsl?raw';

export default function TauVisualizer({
    sourceType = 'mic',
    audioElementId = null,
    colors = {
        core: '#ffe600',
        ring: '#6b6b6b',
        beam: '#00e1ff',
        stripe: '#ff0000',
    },
    sensitivity = { low: 1.5, mid: 1.5, high: 1.5 },
    useVignette = true,
}) {
    const mountRef = useRef(null);

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount) return;

        // scene setup
        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
        camera.position.z = 1;

        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
        });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(mount.clientWidth, mount.clientHeight);

        renderer.render(scene, camera);

        mount.appendChild(renderer.domElement);

        const geometry = new THREE.PlaneGeometry(2, 2);

        const uniforms = {
            uTime: { value: 0 },
            uLow: { value: 0 },
            uMid: { value: 0 },
            uHigh: { value: 0 },
            uCoreColor: { value: new THREE.Color(colors.core) },
            uRingColor: { value: new THREE.Color(colors.ring) },
            uBeamColor: { value: new THREE.Color(colors.beam) },
            uStripeColor: { value: new THREE.Color(colors.stripe) },
            uSensLow: { value: sensitivity.low },
            uSensMid: { value: sensitivity.mid },
            uSensHigh: { value: sensitivity.high },
            uUseVignette: { value: useVignette ? 1.0 : 0.0 },
        };

        const material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms,
        });

        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        // Resize
        const handleResize = () => {
            renderer.setSize(mount.clientWidth, mount.clientHeight);
        };
        window.addEventListener('resize', handleResize);

        // audio setup
        const audioContext = new (window.AudioContext ||
            window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        const freqData = new Uint8Array(analyser.frequencyBinCount);

        if (sourceType === 'mic') {
            navigator.mediaDevices
                .getUserMedia({ audio: true })
                .then((stream) => {
                    const src = audioContext.createMediaStreamSource(stream);
                    src.connect(analyser);
                });
        } else if (sourceType === 'element' && audioElementId) {
            const el = document.getElementById(audioElementId);
            if (el) {
                const src = audioContext.createMediaElementSource(el);
                src.connect(analyser);
                analyser.connect(audioContext.destination);
            }
        }

        // animation loop
        let start = performance.now();
        let frameId;

        const animate = () => {
            frameId = requestAnimationFrame(animate);

            const now = performance.now();
            uniforms.uTime.value = (now - start) / 1000;

            analyser.getByteFrequencyData(freqData);
            const n = freqData.length || 1;

            const getAvg = (start, end) => {
                let sum = 0;
                let count = 0;
                for (let i = start; i < end; i++) {
                    sum += freqData[i];
                    count++;
                }
                return count ? sum / count : 0;
            };

            const low = getAvg(0, n * 0.15);
            const mid = getAvg(n * 0.15, n * 0.5);
            const high = getAvg(n * 0.5, n);

            const norm = (v) => (v / 255) * 1.5;

            uniforms.uLow.value = norm(low);
            uniforms.uMid.value = norm(mid);
            uniforms.uHigh.value = norm(high);

            renderer.render(scene, camera);
        };

        animate();

        return () => {
            cancelAnimationFrame(frameId);
            window.removeEventListener('resize', handleResize);
            mount.removeChild(renderer.domElement);
            renderer.dispose();
            geometry.dispose();
            material.dispose();
        };
    }, [sourceType, audioElementId, colors, sensitivity, useVignette]);

    return (
        <div
            ref={mountRef}
            style={{ margin: 'auto', width: '100%', height: '100%' }}
        />
    );
}
