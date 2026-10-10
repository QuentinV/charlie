import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Box } from '@mui/material';
import TauVisualizer from '../components/AIAvatar/TauVisualizer';
import { api } from '../api/charlie';

const FALLBACK_REPLY = "Je n'ai pas trouvé de réponse à ça.";
const ERROR_REPLY = "Une erreur est survenue, réessaie s'il te plaît.";
const WAKE_UP_REPLY = "Oui ? Dis-moi ce que je peux faire pour toi.";
const SILENCE_MS = 1200;

// Longest first so "hey charlie" is matched before "hey"/"charlie".
const WAKE_KEYWORDS = ['hey charlie', 'hi charlie', 'charlie', 'hey', 'hi'];

const escapeRE = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalize = (s) =>
    (s || '')
        .toLowerCase()
        .replace(/[\u2018\u2019\u201c\u201d\u2013\u2014]/g, ' ')
        .replace(/[.,!?;:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

// Return the recognized text minus the first wake keyword, or null if none.
function stripWake(text) {
    const t = normalize(text);
    if (!t) return null;
    for (const kw of WAKE_KEYWORDS) {
        const re = new RegExp(`(?:^|\\s)${escapeRE(kw)}(?=$|\\s|[.,!?;])`, 'i');
        const m = t.match(re);
        if (m) {
            const before = t.slice(0, m.index);
            const after = t.slice(m.index + m[0].length);
            return `${before} ${after}`.replace(/\s+/g, ' ').trim();
        }
    }
    return null;
}

export const AiPage = () => {
    const [messages, setMessages] = useState(
        /** @type {Array<{sender: string; text: string}>} */ ([])
    );
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [hotwordEnabled, setHotwordEnabled] = useState(false);

    // Values needed inside recognition callbacks, held in refs (never stale).
    const recRef = useRef(null);
    const activeRef = useRef(false); // capturing a command right now
    const manualRef = useRef(false); // push-to-talk: whole phrase is the command
    const hotwordRef = useRef(false);
    const pendingRef = useRef('');
    const silenceTimerRef = useRef(null);

    // Chat WebSocket + audio playback.
    const chatWsRef = useRef(null);
    const wavChunksRef = useRef([]);
    const audioCtxRef = useRef(null);
    const reconnectTimerRef = useRef(null);
    const reconnectAttemptRef = useRef(0);
    const closedByUsRef = useRef(false);

    useEffect(() => {
        hotwordRef.current = hotwordEnabled;
    }, [hotwordEnabled]);

    const pushUser = (text) =>
        setMessages((prev) => [...prev, { sender: 'me', text }]);
    const pushReply = (text) =>
        setMessages((prev) => [...prev, { sender: 'Charlie', text }]);

    // Play back a WAV (array of ArrayBuffer chunks) via Web Audio.
    const playWavBuffer = useCallback((chunks) => {
        if (!chunks || chunks.length === 0) return;
        const blob = new Blob(chunks, { type: 'audio/wav' });
        blob
            .arrayBuffer()
            .then((audioData) => {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx || !Ctx) return;
                if (!audioCtxRef.current) {
                    audioCtxRef.current = new Ctx();
                }
                const ctx = audioCtxRef.current;
                if (!ctx.decodeAudioData || !ctx.destination) return;
                ctx.decodeAudioData(audioData).then((buffer) => {
                    const source = new AudioBufferSourceNode(ctx, { buffer });
                    source.connect(ctx.destination);
                    source.start();
                    if (ctx.state === 'suspended') ctx.resume();
                });
            })
            .catch(() => {
                // audio not playable — ignore
            });
    }, []);

    // Open a persistent socket to the chat WS endpoint.
    const openChatWs = useCallback(() => {
        if (chatWsRef.current) return;
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        closedByUsRef.current = false;
        try {
            const ws = new WebSocket('/ws/chat');
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
                    if (payload.c === 'text') {
                        setInput('');
                        pushReply(
                            typeof payload.v === 'string'
                                ? payload.v
                                : FALLBACK_REPLY
                        );
                        setBusy(false);
                    } else if (payload.c === 'playAudio') {
                        playWavBuffer(wavChunksRef.current);
                        wavChunksRef.current = [];
                        setBusy(false);
                    }
                    return;
                }
                // Binary frame — WAV audio part.
                wavChunksRef.current.push(event.data);
            };

            ws.onclose = () => {
                chatWsRef.current = null;
                setBusy(false);
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
            };
        } catch {
            chatWsRef.current = null;
        }
    }, [playWavBuffer]);

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

    // Open the chat socket on mount; close it when leaving the page.
    useEffect(() => {
        openChatWs();
        return () => {
            closedByUsRef.current = true;
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
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

    // Finalize the current utterance: it's sent once the user stops talking.
    const finalizeCurrent = () => {
        if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
        }
        const wasActive = activeRef.current;
        const command = pendingRef.current;
        pendingRef.current = '';
        activeRef.current = false;
        manualRef.current = false;
        setIsListening(false);
        if (wasActive) setInput('');

        if (recRef.current) {
            try {
                recRef.current.stop();
            } catch {
                // best effort
            }
            recRef.current = null;
        }

        const trimmed = command.trim();
        if (wasActive) {
            if (trimmed) send(trimmed);
            else pushReply(WAKE_UP_REPLY);
        }

        if (hotwordRef.current) {
            setTimeout(() => startRecognition(), 200);
        }
    };

    const resetSilenceTimer = () => {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(finalizeCurrent, SILENCE_MS);
    };

    // Single continuous recognition that powers both the wake word and
    // push-to-talk. `forceActive` pre-arms "manual" mode (whole phrase = command).
    const startRecognition = ({ forceActive = false } = {}) => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return false;

        if (recRef.current) {
            if (forceActive && !activeRef.current) {
                activeRef.current = true;
                manualRef.current = true;
                pendingRef.current = '';
                setIsListening(true);
                resetSilenceTimer();
            }
            return true;
        }

        const rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'fr-FR';
        recRef.current = rec;

        activeRef.current = forceActive;
        manualRef.current = forceActive;
        pendingRef.current = '';
        if (forceActive) setIsListening(true);

        rec.onresult = (event) => {
            // Chrome (esp. Android, where `continuous` isn't honoured) appends
            // a new hypothesis for every update of the SAME utterance
            // ("eteins", "etins la", "eteins la lumiere"...), re-sending the
            // whole list each event. The LAST entry is the most complete, so
            // never join results - joining duplicates the sentence.
            const results = event.results;
            let transcript = '';
            for (let i = results.length - 1; i >= 0; i--) {
                const t = results[i]?.[0]?.transcript ?? '';
                if (t) {
                    transcript = t;
                    break;
                }
            }
            const text = normalize(transcript);

            if (manualRef.current) {
                pendingRef.current = text;
            } else {
                const rest = stripWake(text);
                if (rest !== null) {
                    if (!activeRef.current) {
                        activeRef.current = true;
                        setIsListening(true);
                    }
                    pendingRef.current = rest;
                }
            }

            if (activeRef.current) {
                setInput(pendingRef.current);
                resetSilenceTimer();
            }
        };

        rec.onerror = (event) => {
            const code = event?.error ?? 'unknown';
            console.error(
                '[AiPage] speech recognition error:',
                code,
                event?.message ?? ''
            );
            const wasActive = activeRef.current;
            const wasManual = manualRef.current;
            recRef.current = null;
            activeRef.current = false;
            manualRef.current = false;
            pendingRef.current = '';
            setIsListening(false);

            if (wasActive && wasManual) {
                const messages = {
                    'not-allowed':
                        "Accès au micro refusé. Autorise le microphone pour ce site puis réessaie.",
                    'service-not-allowed':
                        "La reconnaissance vocale est bloquée. Autorise le micro pour ce site puis réessaie.",
                    'audio-capture':
                        "Micro indisponible (déjà utilisé par une autre application ?).",
                    network:
                        'Reconnaissance vocale indisponible (problème réseau).',
                    service: 'Service de reconnaissance vocale indisponible.',
                    'language-not-supported':
                        'Langue non supportée par la reconnaissance vocale.',
                    'no-speech': "Je n'ai rien entendu, réessaie.",
                    aborted: null,
                };
                const msg =
                    code in messages
                        ? messages[code]
                        : `Reconnaissance vocale indisponible (${code}).`;
                if (msg) pushReply(msg);
            }
        };

        rec.onend = () => {
            const wasActive = activeRef.current;
            recRef.current = null;
            if (wasActive) {
                finalizeCurrent();
            } else if (hotwordRef.current) {
                setTimeout(() => startRecognition(), 200);
            }
        };

        try {
            rec.start();
        } catch (e) {
            console.error('[AiPage] speech recognition start failed:', e);
            recRef.current = null;
            activeRef.current = false;
            manualRef.current = false;
            setIsListening(false);
            if (forceActive) {
                pushReply(
                    'Impossible de démarrer la reconnaissance vocale.'
                );
            }
            return false;
        }
        return true;
    };

    const toggleHotword = () => {
        const next = !hotwordRef.current;
        hotwordRef.current = next;
        setHotwordEnabled(next);
        if (next) {
            startRecognition();
        } else if (activeRef.current) {
            finalizeCurrent();
        } else {
            if (recRef.current) {
                try {
                    recRef.current.stop();
                } catch {
                    // best effort
                }
                recRef.current = null;
            }
            if (silenceTimerRef.current) {
                clearTimeout(silenceTimerRef.current);
                silenceTimerRef.current = null;
            }
            setIsListening(false);
        }
    };

    const onToggleMic = () => {
        if (activeRef.current) {
            finalizeCurrent(); // already capturing — send now
            return;
        }
        const started = startRecognition({ forceActive: true });
        if (!started) {
            pushReply(
                'Reconnaissance vocale non supportée sur ce navigateur.'
            );
        }
    };

    // Stop recognition + timers when leaving the page.
    useEffect(() => {
        return () => {
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            if (recRef.current) {
                try {
                    recRef.current.stop();
                } catch {
                    // best effort
                }
                recRef.current = null;
            }
        };
    }, []);

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
                isListening={isListening}
                busy={busy}
                activity={isListening ? 1 : 0}
                hotwordEnabled={hotwordEnabled}
                onToggleHotword={toggleHotword}
            />
        </Box>
    );
};
