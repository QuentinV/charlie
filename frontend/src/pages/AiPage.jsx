import React, { useEffect, useState, useRef } from 'react';
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

    useEffect(() => {
        hotwordRef.current = hotwordEnabled;
    }, [hotwordEnabled]);

    const pushUser = (text) =>
        setMessages((prev) => [...prev, { sender: 'me', text }]);
    const pushReply = (text) =>
        setMessages((prev) => [...prev, { sender: 'Charlie', text }]);

    const send = async (text) => {
        const trimmed = (text ?? '').trim();
        if (!trimmed) return;
        pushUser(trimmed);
        setInput('');
        setBusy(true);
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
            let text = '';
            for (let i = 0; i < event.results.length; i++) {
                text += ' ' + (event.results[i]?.[0]?.transcript ?? '');
            }
            text = normalize(text);

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

        rec.onerror = () => {
            recRef.current = null;
            activeRef.current = false;
            manualRef.current = false;
            pendingRef.current = '';
            setIsListening(false);
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

        rec.start();
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
