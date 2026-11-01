import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Box } from '@mui/material';
import TauVisualizer from '../components/AIAvatar/TauVisualizer';
import { api, getToken } from '../api/charlie';
import { MicCapture } from '../audio/micCapture';

const FALLBACK_REPLY = "Je n'ai pas trouvé de réponse à ça.";
const ERROR_REPLY = "Une erreur est survenue, réessaie s'il te plaît.";
const MIC_ERROR_REPLY =
    "Je n'ai pas pu accéder au micro. Autorise le microphone pour ce site puis réessaie.";
const INSECURE_REPLY =
    'Le micro nécessite une connexion sécurisée (HTTPS) ou localhost.';

/**
 * AI chat page.
 *
 * Speech recognition runs **server-side**: the browser captures the mic,
 * frames each utterance (VAD / push-to-talk) and streams PCM16 to `/ws/chat`,
 * where the Charlie brain runs the local ASR + voice profiler (see
 * `nodejs-apis/src/ai/chat-server.ts`). Wake words and the follow-up window
 * are handled by the server, exactly like the echo devices.
 */
export const AiPage = () => {
    const [messages, setMessages] = useState(
        /** @type {Array<{sender: string; text: string}>} */ ([])
    );
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [hotwordEnabled, setHotwordEnabled] = useState(false);
    const [awaitingReply, setAwaitingReply] = useState(false);
    const [level, setLevel] = useState(0);

    // Chat WebSocket + audio playback.
    const chatWsRef = useRef(null);
    const wavChunksRef = useRef([]);
    const audioCtxRef = useRef(null);
    const reconnectTimerRef = useRef(null);
    const reconnectAttemptRef = useRef(0);
    const closedByUsRef = useRef(false);

    // Microphone capture → server-side ASR (see src/audio/micCapture.js).
    const captureRef = useRef(null);
    const hotwordRef = useRef(false);
    // Server-driven "the assistant expects an answer" flag (the echo devices
    // call it `expectFollowUp`): it comes from `playAudio.conversation`.
    const followUpRef = useRef(false);
    const playingRef = useRef(false);
    const lastLevelAtRef = useRef(0);

    useEffect(() => {
        hotwordRef.current = hotwordEnabled;
    }, [hotwordEnabled]);

    const pushUser = useCallback(
        (text) => setMessages((prev) => [...prev, { sender: 'me', text }]),
        []
    );
    const pushReply = useCallback(
        (text) => setMessages((prev) => [...prev, { sender: 'Charlie', text }]),
        []
    );

    // ---- microphone ------------------------------------------------------

    // Restore the capture mode after playback / at the end of an utterance.
    // A pending follow-up (`conversation: true`) keeps the mic open exactly
    // like the hotword mode, so the user can answer without pressing anything.
    const syncCaptureMode = useCallback(() => {
        const capture = captureRef.current;
        if (!capture) return;
        if (!playingRef.current && (hotwordRef.current || followUpRef.current))
            capture.setMode('auto');
        else capture.setMode('idle');
    }, []);

    // Release the mic when nothing needs it (no hotword, no pending
    // follow-up, no live utterance).
    const releaseIfIdle = useCallback(() => {
        const capture = captureRef.current;
        if (!capture) return;
        if (
            hotwordRef.current ||
            followUpRef.current ||
            capture.speaking ||
            playingRef.current
        )
            return;
        captureRef.current = null;
        void capture.stop();
    }, []);

    const ensureCapture = useCallback(async () => {
        if (captureRef.current) return true;

        const capture = new MicCapture({
            onStart: ({ manual }) => {
                const ws = chatWsRef.current;
                if (ws?.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ c: 'start', manual }));
                }
                // The user is answering: the "waiting for a reply" hint ends
                // here, and the next server turn re-arms it if needed.
                setAwaitingReply(false);
                setIsListening(true);
            },
            onChunk: (buffer) => {
                const ws = chatWsRef.current;
                if (ws?.readyState === WebSocket.OPEN) ws.send(buffer);
            },
            onEnd: () => {
                const ws = chatWsRef.current;
                if (ws?.readyState === WebSocket.OPEN) {
                    ws.send('end');
                    // Waiting for the transcription + the answer.
                    setBusy(true);
                }
                setIsListening(false);
                setLevel(0);
                syncCaptureMode();
                releaseIfIdle();
            },
            onLevel: (rms) => {
                // Throttle the visualiser updates (~10/s).
                const now = performance.now();
                if (now - lastLevelAtRef.current < 100) return;
                lastLevelAtRef.current = now;
                setLevel(Math.min(1, rms * 10));
            },
            onError: (error) => {
                console.error('[AiPage] microphone error:', error);
                pushReply(
                    error?.message === 'insecure-context'
                        ? INSECURE_REPLY
                        : MIC_ERROR_REPLY
                );
                setIsListening(false);
                hotwordRef.current = false;
                setHotwordEnabled(false);
            },
        });

        const ok = await capture.start();
        if (!ok) return false;
        captureRef.current = capture;
        syncCaptureMode();
        return true;
    }, [pushReply, releaseIfIdle, syncCaptureMode]);

    const toggleHotword = useCallback(async () => {
        const next = !hotwordRef.current;
        hotwordRef.current = next;
        setHotwordEnabled(next);
        if (next) {
            const ok = await ensureCapture();
            if (!ok) {
                hotwordRef.current = false;
                setHotwordEnabled(false);
                return;
            }
            captureRef.current?.setMode('auto');
        } else {
            // Keep listening if the assistant still expects an answer.
            syncCaptureMode();
            releaseIfIdle();
        }
    }, [ensureCapture, releaseIfIdle, syncCaptureMode]);

    const onToggleMic = useCallback(async () => {
        const capture = captureRef.current;
        if (capture?.speaking && capture.manual) {
            capture.end(); // push-to-talk release → send what we have
            return;
        }
        const ok = await ensureCapture();
        if (!ok) return;
        captureRef.current?.begin();
    }, [ensureCapture]);

    // ---- audio playback --------------------------------------------------

    const resumeCapture = useCallback(() => {
        playingRef.current = false;
        // Tell the server the reply finished playing so it (re)opens the
        // follow-up window from *now*: otherwise the window runs from the
        // moment the reply was sent and the playback eats most of it.
        if (followUpRef.current) {
            const ws = chatWsRef.current;
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ c: 'played' }));
            }
        }
        syncCaptureMode();
        releaseIfIdle();
    }, [releaseIfIdle, syncCaptureMode]);

    // Play back a WAV (array of ArrayBuffer chunks) via Web Audio.
    const playWavBuffer = useCallback(
        (chunks) => {
            if (!chunks || chunks.length === 0) {
                resumeCapture();
                return;
            }

            // Charlie is talking: stop feeding the mic to the server so the
            // synthesised voice isn't transcribed back into the conversation.
            playingRef.current = true;
            captureRef.current?.setMode('idle');

            const blob = new Blob(chunks, { type: 'audio/wav' });
            blob.arrayBuffer()
                .then((audioData) => {
                    const Ctx =
                        window.AudioContext || window.webkitAudioContext;
                    if (!Ctx) {
                        resumeCapture();
                        return;
                    }
                    if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
                    const ctx = audioCtxRef.current;
                    if (!ctx.decodeAudioData || !ctx.destination) {
                        resumeCapture();
                        return;
                    }
                    ctx.decodeAudioData(audioData)
                        .then((buffer) => {
                            const source = new AudioBufferSourceNode(ctx, {
                                buffer,
                            });
                            source.connect(ctx.destination);
                            source.onended = () => resumeCapture();
                            source.start();
                            if (ctx.state === 'suspended') ctx.resume();
                        })
                        .catch(() => resumeCapture());
                })
                .catch(() => resumeCapture());
        },
        [resumeCapture]
    );

    // ---- chat WebSocket --------------------------------------------------

    // Open a persistent socket to the chat WS endpoint.
    const openChatWs = useCallback(() => {
        if (chatWsRef.current) return;
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        closedByUsRef.current = false;
        try {
            // Browser sockets cannot set an Authorization header: the token
            // travels as a query parameter (validated by chat-server.ts).
            const token = getToken();
            const ws = new WebSocket(
                `/ws/chat${token ? `?token=${encodeURIComponent(token)}` : ''}`
            );
            chatWsRef.current = ws;

            ws.onopen = () => {
                reconnectAttemptRef.current = 0;
            };

            ws.onmessage = (event) => {
                if (typeof event.data === 'string') {
                    let payload = null;
                    try {
                        payload = JSON.parse(event.data);
                    } catch {
                        return;
                    }
                    if (!payload) return;
                    if (payload.c === 'transcript') {
                        // What the server-side ASR heard.
                        if (typeof payload.v === 'string' && payload.v.trim()) {
                            pushUser(payload.v.trim());
                        }
                    } else if (payload.c === 'text') {
                        setInput('');
                        pushReply(
                            typeof payload.v === 'string'
                                ? payload.v
                                : FALLBACK_REPLY
                        );
                        setBusy(false);
                    } else if (payload.c === 'playAudio') {
                        // Server-driven conversation mode (the echo devices
                        // call it `expectFollowUp`): keep the microphone open
                        // when the assistant expects an answer.
                        const wantsReply = !!payload.conversation;
                        followUpRef.current = wantsReply;
                        setAwaitingReply(wantsReply);
                        // Warm the mic up while it is still muted by the
                        // playback, so it is ready the instant Charlie stops
                        // talking (getUserMedia + worklet load would otherwise
                        // eat the first words of the answer).
                        if (wantsReply) void ensureCapture();
                        playWavBuffer(wavChunksRef.current);
                        wavChunksRef.current = [];
                        setBusy(false);
                    }
                    return;
                }
                // Binary frame — WAV audio part.
                wavChunksRef.current.push(event.data);
            };

            ws.onclose = (event) => {
                chatWsRef.current = null;
                setBusy(false);
                // No server → nothing to wait for.
                followUpRef.current = false;
                setAwaitingReply(false);
                // 4401 = the server rejected the token: retrying would loop.
                if (event?.code === 4401) return;
                // Reconnect with backoff unless we closed it on purpose.
                if (!closedByUsRef.current) {
                    const attempt = (reconnectAttemptRef.current += 1);
                    const delay = Math.min(1000 * 2 ** (attempt - 1), 15000);
                    reconnectTimerRef.current = setTimeout(() => {
                        reconnectTimerRef.current = null;
                        openChatWs();
                    }, delay);
                }
            };
            // onclose always follows onerror, so reconnect is handled there.
            ws.onerror = () => {
                setBusy(false);
                followUpRef.current = false;
                setAwaitingReply(false);
            };
        } catch {
            chatWsRef.current = null;
        }
    }, [ensureCapture, playWavBuffer, pushReply, pushUser]);

    const send = async (text) => {
        const trimmed = (text ?? '').trim();
        if (!trimmed) return;
        pushUser(trimmed);
        setInput('');
        setBusy(true);

        const ws = chatWsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(trimmed);
            return; // the reply (text + audio) comes back over the socket
        }

        // Fallback: REST endpoint if the socket isn't available.
        try {
            const res = await api('assistant/chat', {
                method: 'POST',
                body: JSON.stringify({ message: trimmed }),
            });
            const reply =
                typeof res === 'string' && res.trim() ? res : FALLBACK_REPLY;
            pushReply(reply);
        } catch {
            pushReply(ERROR_REPLY);
        } finally {
            setBusy(false);
        }
    };

    // Open the chat socket on mount; close it (and the mic) when leaving.
    useEffect(() => {
        openChatWs();
        return () => {
            closedByUsRef.current = true;
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }

            const capture = captureRef.current;
            captureRef.current = null;
            void capture?.stop();

            const ws = chatWsRef.current;
            chatWsRef.current = null;
            if (!ws) return;
            if (ws.readyState === WebSocket.CONNECTING) {
                // Closing a CONNECTING socket logs a console error, so wait
                // for the handshake to finish and close right after.
                ws.onopen = () => {
                    try {
                        ws.close();
                    } catch {
                        // best effort
                    }
                };
            } else if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.close();
                } catch {
                    // best effort
                }
            }
        };
    }, [openChatWs]);

    return (
        <Box
            sx={{
                display: 'flex',
                flexWrap: 'wrap',
                width: '100%',
                height: '100%',
            }}
        >
            <TauVisualizer
                sourceType="none"
                messages={messages}
                input={input}
                onInputChange={setInput}
                onSend={() => send(input)}
                onToggleMic={onToggleMic}
                isListening={isListening || awaitingReply}
                busy={busy}
                activity={isListening ? level : 0}
                hotwordEnabled={hotwordEnabled}
                onToggleHotword={toggleHotword}
            />
        </Box>
    );
};
