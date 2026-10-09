import React, { useEffect, useRef } from 'react';
import {
    Box,
    Paper,
    Typography,
    TextField,
    IconButton,
    Avatar,
    Stack,
    alpha,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import * as THREE from 'three';
import fragmentShader from './tauFragment.glsl?raw';
import vertexShader from './tauVertex.glsl?raw';
import './tauChat.css';

// Hoisted to module scope so their identity stays stable across renders.
// (Were previously inline object literals, which get a fresh identity on every
// re-render and would make the WebGL useEffect tear down / recreate the scene
// on each keystroke or chat update.)
const DEFAULT_COLORS = {
    core: '#ffe600',
    ring: '#6b6b6b',
    beam: '#00e1ff',
    stripe: '#ff0000',
};
const DEFAULT_SENSITIVITY = { low: 1.5, mid: 1.5, high: 1.5 };
const DEFAULT_USE_VIGNETTE = true;

export default function TauVisualizer({
    sourceType = 'mic',
    audioElementId = null,
    colors = DEFAULT_COLORS,
    sensitivity = DEFAULT_SENSITIVITY,
    useVignette = DEFAULT_USE_VIGNETTE,
    // ---- Integrated chat ----
    messages = [],
    input = '',
    onInputChange = () => {},
    onSend = () => {},
    onToggleMic = () => {},
    onToggleHotword = () => {},
    hotwordEnabled = false,
    isListening = false,
    busy = false,
    activity = 0,
}) {
    const mountRef = useRef(null);
    const chatScrollRef = useRef(null);

    // Mirror `isListening` into a ref so the WebGL effect can gate its audio
    // reactivity each frame without being torn down / recreated on toggle.
    const listeningRef = useRef(isListening);
    useEffect(() => {
        listeningRef.current = isListening;
    }, [isListening]);

    // Mirror `activity` into a ref for a subtle baseline pulse while listening.
    const activityRef = useRef(activity);
    useEffect(() => {
        activityRef.current = activity;
    }, [activity]);

    // Keep the conversation scrolled to the latest message.
    useEffect(() => {
        const el = chatScrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages, busy]);

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount) return;

        // Declared out here so the cleanup can always release whatever the
        // setup managed to create before failing.
        let renderer = null;
        let geometry = null;
        let material = null;
        let audioContext = null;
        let analyser = null;
        let freqData = null;
        let micStream = null;
        let uniforms = null;
        let frameId = null;
        let resizeObserver = null;

        // Resize — refresh the canvas AND the aspect uniform so the pattern
        // keeps its proportions on any screen / orientation.
        const handleResize = () => {
            if (!renderer) return;
            const w = mount.clientWidth || 1;
            const h = mount.clientHeight || 1;
            renderer.setSize(w, h);
            uniforms?.uResolution.value.set(w, h);
        };

        try {
            // scene setup
            const scene = new THREE.Scene();
            const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
            camera.position.z = 1;

            renderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: true,
            });
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setSize(mount.clientWidth, mount.clientHeight);

            renderer.render(scene, camera);

            mount.appendChild(renderer.domElement);

            geometry = new THREE.PlaneGeometry(2, 2);

            uniforms = {
                uTime: { value: 0 },
                uResolution: {
                    value: new THREE.Vector2(
                        mount.clientWidth || 1,
                        mount.clientHeight || 1
                    ),
                },
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

            material = new THREE.ShaderMaterial({
                vertexShader,
                fragmentShader,
                uniforms,
            });

            const mesh = new THREE.Mesh(geometry, material);
            scene.add(mesh);

            window.addEventListener('resize', handleResize);
            if (typeof ResizeObserver !== 'undefined') {
                // Covers container resizes (mobile URL bar, rotation, layout).
                resizeObserver = new ResizeObserver(handleResize);
                resizeObserver.observe(mount);
            }

            // audio setup — best effort; the visualizer still runs without it.
            // `sourceType === 'none'` skips capture entirely so the mic stays
            // free for SpeechRecognition (which needs it exclusively on mobile).
            try {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (Ctx && sourceType !== 'none') {
                    audioContext = new Ctx();
                    analyser = audioContext.createAnalyser();
                    analyser.fftSize = 512;
                    freqData = new Uint8Array(analyser.frequencyBinCount);

                    if (sourceType === 'mic') {
                        // navigator.mediaDevices is undefined on non-secure
                        // origins (plain HTTP on a LAN IP) — never let it throw.
                        navigator.mediaDevices
                            ?.getUserMedia({ audio: true })
                            .then((stream) => {
                                micStream = stream;
                                const src =
                                    audioContext.createMediaStreamSource(
                                        stream
                                    );
                                src.connect(analyser);
                            })
                            .catch(() => {
                                // no mic (insecure context / denied) — ignore
                            });
                    } else if (
                        sourceType === 'element' &&
                        audioElementId
                    ) {
                        const el = document.getElementById(audioElementId);
                        if (el) {
                            const src =
                                audioContext.createMediaElementSource(el);
                            src.connect(analyser);
                            analyser.connect(audioContext.destination);
                        }
                    }
                }
            } catch {
                // audio analysis unavailable — the τ simply stays calm
                analyser = null;
                freqData = null;
            }

            // animation loop
            const start = performance.now();

            const animate = () => {
                frameId = requestAnimationFrame(animate);

                const now = performance.now();
                uniforms.uTime.value = (now - start) / 1000;

                let low = 0;
                let mid = 0;
                let high = 0;
                if (analyser && freqData) {
                    analyser.getByteFrequencyData(freqData);
                    const n = freqData.length || 1;

                    const getAvg = (from, to) => {
                        let sum = 0;
                        let count = 0;
                        for (let i = from; i < to; i++) {
                            sum += freqData[i];
                            count++;
                        }
                        return count ? sum / count : 0;
                    };

                    low = getAvg(0, n * 0.15);
                    mid = getAvg(n * 0.15, n * 0.5);
                    high = getAvg(n * 0.5, n);
                }

                const norm = (v) => (v / 255) * 1.5;

                // The δ reacts to audio ONLY while Charlie is listening. When
                // not listening the τ stays calm (no breathing / no energy).
                const listening = listeningRef.current;
                const act = listening ? activityRef.current : 0;
                const energy =
                    act > 0
                        ? 0.35 +
                          0.65 * Math.abs(Math.sin((now - start) / 240)) * act
                        : 0;

                uniforms.uLow.value = listening
                    ? Math.max(norm(low), energy * 0.5)
                    : 0;
                uniforms.uMid.value = listening
                    ? Math.max(norm(mid), energy * 0.85)
                    : 0;
                uniforms.uHigh.value = listening
                    ? Math.max(norm(high), energy * 0.4)
                    : 0;

                renderer.render(scene, camera);
            };

            animate();
        } catch (err) {
            // A missing WebGL context (or any other init failure) must never
            // blank the whole app — log it and leave the mount empty.
            console.error('TauVisualizer: failed to initialise', err);
        }

        return () => {
            if (frameId) cancelAnimationFrame(frameId);
            window.removeEventListener('resize', handleResize);
            resizeObserver?.disconnect();
            try {
                if (renderer) {
                    if (renderer.domElement?.parentNode === mount) {
                        mount.removeChild(renderer.domElement);
                    }
                    renderer.dispose();
                }
                geometry?.dispose();
                material?.dispose();
                if (micStream) {
                    micStream.getTracks().forEach((track) => track.stop());
                }
                if (audioContext && audioContext.state !== 'closed') {
                    audioContext.close();
                }
            } catch {
                // best effort
            }
        };
    }, [sourceType, audioElementId, colors, sensitivity, useVignette]);

    return (
        <Box
            sx={{
                position: 'relative',
                width: '100%',
                height: '100%',
                overflow: 'hidden',
            }}
        >
            <Box
                ref={mountRef}
                sx={{ margin: 'auto', width: '100%', height: '100%' }}
            />
            {activity > 0 && <Box className="hud-energy" />}

            {/* Jarvis title chip */}
            <Box
                sx={{
                    position: 'absolute',
                    top: 14,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 2,
                    py: 0.75,
                    borderRadius: 2,
                    bgcolor: 'rgba(8, 10, 14, 0.4)',
                    backdropFilter: 'blur(8px) saturate(140%)',
                    border: '1px solid rgba(255,215,0,0.2)',
                    boxShadow: '0 0 18px -6px rgba(0,225,255,0.35)',
                }}
            >
                <SmartToyIcon
                    sx={{ color: 'primary.main', fontSize: 18 }}
                />
                <Typography
                    className="hud-text"
                    variant="subtitle1"
                    sx={{
                        fontWeight: 700,
                        letterSpacing: 4,
                        fontSize: '0.78rem',
                        color: 'text.primary',
                    }}
                >
                    CHARLIE
                </Typography>
                {(busy || isListening) && (
                    <Box
                        className="hud-eq"
                        sx={{ color: 'warning.main' }}
                    >
                        <span />
                        <span />
                        <span />
                    </Box>
                )}
                <Box
                    className="hud-status-dot"
                    sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor:
                            busy || isListening
                                ? 'warning.main'
                                : hotwordEnabled
                                    ? 'info.main'
                                    : 'success.main',
                        '--hud-dot':
                            busy || isListening
                                ? 'rgba(255,179,0,.9)'
                                : hotwordEnabled
                                    ? 'rgba(78,200,245,.9)'
                                    : 'rgba(76,217,100,.9)',
                    }}
                />
                <IconButton
                    aria-label={
                        hotwordEnabled
                            ? 'désactiver le réveil vocal'
                            : 'activer le réveil vocal'
                    }
                    size="small"
                    onClick={onToggleHotword}
                    title={
                        hotwordEnabled
                            ? 'Réveil vocal activé (charlie / hey / hi)'
                            : 'Activer le réveil vocal (charlie / hey / hi)'
                    }
                    sx={{
                        color: hotwordEnabled
                            ? 'primary.main'
                            : 'text.disabled',
                        bgcolor: hotwordEnabled
                            ? alpha('#FFD700', 0.15)
                            : 'transparent',
                        '&:hover': {
                            bgcolor: alpha('#FFD700', 0.15),
                        },
                    }}
                >
                    {hotwordEnabled ? (
                        <MicIcon fontSize="small" />
                    ) : (
                        <MicOffIcon fontSize="small" />
                    )}
                </IconButton>
            </Box>

            {/* Conversation floating over the τ */}
            <Paper
                ref={chatScrollRef}
                elevation={0}
                sx={{
                    position: 'absolute',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    top: { xs: 76, md: 92 },
                    bottom: { xs: 92, sm: 98 },
                    width: { xs: '94%', sm: 560, md: 640 },
                    maxWidth: '94%',
                    background: 'transparent',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 1,
                    py: 1,
                    overflowY: 'auto',
                    zIndex: 5,
                }}
            >
                    {messages.length === 0 && (
                        <Typography
                            variant="body2"
                            sx={{
                                color: 'text.secondary',
                                textAlign: 'center',
                                mt: 3,
                            }}
                        >
                            Parle-moi ou écris ta question ✨
                        </Typography>
                    )}
                    {messages.map((msg, i) => (
                        <Stack
                            key={i}
                            className="hud-msg"
                            direction="row"
                            spacing={1}
                            alignItems="flex-end"
                            justifyContent={
                                msg.sender === 'me' ? 'flex-end' : 'flex-start'
                            }
                            sx={{ width: '100%' }}
                        >
                            {msg.sender !== 'me' && (
                                <Avatar
                                    sx={{
                                        bgcolor: 'primary.main',
                                        color: '#111',
                                        width: 28,
                                        height: 28,
                                    }}
                                >
                                    <SmartToyIcon sx={{ fontSize: 16 }} />
                                </Avatar>
                            )}
                            <Box
                                sx={{
                                    bgcolor:
                                        msg.sender === 'me'
                                            ? 'rgba(255,215,0,0.82)'
                                            : 'rgba(8, 10, 14, 0.5)',
                                    color:
                                        msg.sender === 'me'
                                            ? '#0A0A0B'
                                            : 'text.primary',
                                    border:
                                        msg.sender === 'me'
                                            ? '1px solid rgba(255,230,128,0.55)'
                                            : '1px solid rgba(0,225,255,0.25)',
                                    px: 1.75,
                                    py: 1,
                                    borderRadius: 2,
                                    borderTopRightRadius:
                                        msg.sender === 'me' ? 4 : 14,
                                    borderTopLeftRadius:
                                        msg.sender === 'me' ? 14 : 4,
                                    maxWidth: '80%',
                                    boxShadow:
                                        msg.sender === 'me'
                                            ? '0 0 18px -2px rgba(255,215,0,.5), inset 0 0 10px rgba(255,230,128,.2)'
                                            : '0 0 12px -2px rgba(0,225,255,.22)',
                                    backdropFilter:
                                        msg.sender === 'me'
                                            ? 'none'
                                            : 'blur(8px) saturate(150%)',
                                }}
                            >
                                <Typography
                                    className="hud-text"
                                    variant="body2"
                                    sx={{
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                    }}
                                >
                                    {msg.text}
                                </Typography>
                            </Box>
                        </Stack>
                    ))}
                    {busy && (
                        <Stack
                            className="hud-msg"
                            direction="row"
                            spacing={1}
                            alignItems="flex-end"
                            justifyContent="flex-start"
                            sx={{ width: '100%' }}
                        >
                            <Avatar
                                sx={{
                                    bgcolor: 'primary.main',
                                    color: '#111',
                                    width: 28,
                                    height: 28,
                                }}
                            >
                                <SmartToyIcon sx={{ fontSize: 16 }} />
                            </Avatar>
                            <Box
                                sx={{
                                    bgcolor: 'rgba(8, 10, 14, 0.5)',
                                    color: 'text.primary',
                                    border: '1px solid rgba(0,225,255,0.25)',
                                    px: 1.5,
                                    py: 1,
                                    borderRadius: 2,
                                    borderTopLeftRadius: 14,
                                }}
                            >
                                <Box
                                    className="hud-eq"
                                    sx={{ color: 'success.main' }}
                                >
                                    <span />
                                    <span />
                                    <span />
                                </Box>
                            </Box>
                        </Stack>
                    )}
                </Paper>
                <Box
                    sx={{
                        position: 'absolute',
                        left: '50%',
                        bottom: 14,
                        transform: 'translateX(-50%)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        p: 1,
                        width: { xs: '94%', sm: 560, md: 640 },
                        maxWidth: '94%',
                        borderRadius: 3,
                        bgcolor: 'rgba(8, 10, 14, 0.5)',
                        backdropFilter: 'blur(10px) saturate(150%)',
                        border: '1px solid rgba(255,215,0,0.22)',
                        boxShadow:
                            '0 0 26px -6px rgba(0,225,255,0.28), inset 0 0 0 1px rgba(255,215,0,0.08)',
                        zIndex: 5,
                    }}
                >
                    <IconButton
                        aria-label={isListening ? 'stop listening' : 'mic'}
                        size="small"
                        onClick={onToggleMic}
                        sx={{
                            color: isListening ? 'error.main' : 'primary.main',
                            bgcolor: isListening
                                ? alpha('#FF5D5D', 0.18)
                                : alpha('#FFD700', 0.1),
                            '&:hover': {
                                bgcolor: alpha('#FFD700', 0.2),
                            },
                        }}
                    >
                        {isListening ? (
                            <MicOffIcon fontSize="small" />
                        ) : (
                            <MicIcon fontSize="small" />
                        )}
                    </IconButton>
                    <TextField
                        placeholder="Demande-moi n'importe quoi…"
                        variant="outlined"
                        size="small"
                        fullWidth
                        value={input}
                        onChange={(e) => onInputChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') onSend();
                        }}
                        sx={{
                            '& .MuiOutlinedInput-root': {
                                borderRadius: 2,
                                bgcolor: 'rgba(8, 10, 14, 0.4)',
                                '& fieldset': {
                                    borderColor: 'rgba(255,215,0,0.25)',
                                },
                                '&:hover fieldset': {
                                    borderColor: 'rgba(255,215,0,0.5)',
                                },
                                '&.Mui-focused fieldset': {
                                    borderColor: 'rgba(255,215,0,0.75)',
                                },
                            },
                        }}
                    />
                    <IconButton
                        aria-label="send"
                        onClick={onSend}
                        disabled={busy}
                        sx={{
                            color: 'primary.main',
                            bgcolor: alpha('#FFD700', 0.1),
                            boxShadow: '0 0 12px -2px rgba(255,215,0,.45)',
                            '&:hover': {
                                bgcolor: alpha('#FFD700', 0.2),
                                boxShadow: '0 0 18px -2px rgba(255,215,0,.7)',
                            },
                        }}
                    >
                        <SendIcon fontSize="small" />
                    </IconButton>
                </Box>
        </Box>
    );
}
