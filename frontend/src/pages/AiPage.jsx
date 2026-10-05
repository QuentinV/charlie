import React, { useEffect, useCallback, useState, useRef } from 'react';
import { Box } from '@mui/material';
import TauVisualizer from '../components/AIAvatar/TauVisualizer';
import { api } from '../api/charlie';

const FALLBACK_REPLY = "Je n'ai pas trouvé de réponse à ça.";
const ERROR_REPLY = "Une erreur est survenue, réessaie s'il te plaît.";

export const AiPage = () => {
    const [messages, setMessages] = useState(
        /** @type {Array<{sender: string; text: string}>} */ ([])
    );
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [isListening, setIsListening] = useState(false);

    const recognitionRef = useRef(null);
    const finalTextRef = useRef('');

    const send = useCallback(async (text) => {
        const trimmed = (text ?? '').trim();
        if (!trimmed) return;

        setMessages((prev) => [...prev, { sender: 'me', text: trimmed }]);
        setInput('');
        setBusy(true);

        try {
            const res = await api('assistant/chat', {
                method: 'POST',
                body: JSON.stringify({ message: trimmed }),
            });
            const reply =
                typeof res === 'string' && res.trim()
                    ? res
                    : FALLBACK_REPLY;
            setMessages((prev) => [
                ...prev,
                { sender: 'Charlie', text: reply },
            ]);
        } catch {
            setMessages((prev) => [
                ...prev,
                { sender: 'Charlie', text: ERROR_REPLY },
            ]);
        } finally {
            setBusy(false);
        }
    }, []);

    const stopListening = useCallback(() => {
        if (recognitionRef.current) {
            try {
                recognitionRef.current.stop();
            } catch {
                // best effort
            }
        }
        recognitionRef.current = null;
        finalTextRef.current = '';
        setIsListening(false);
    }, []);

    // Stop any ongoing recognition when leaving the page.
    useEffect(() => {
        return () => stopListening();
    }, [stopListening]);

    const toggleMic = useCallback(() => {
        if (isListening) {
            stopListening();
            return;
        }

        const SR =
            window.SpeechRecognition ||
            window.webkitSpeechRecognition;
        if (!SR) {
            setMessages((prev) => [
                ...prev,
                {
                    sender: 'Charlie',
                    text: 'Votre navigateur ne supporte pas la reconnaissance vocale.',
                },
            ]);
            return;
        }

        const recognition = new SR();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'fr-FR';

        recognitionRef.current = recognition;
        finalTextRef.current = '';
        setInput('');
        setIsListening(true);

        recognition.onresult = (event) => {
            let interim = '';
            for (
                let i = event.resultIndex;
                i < event.results.length;
                i++
            ) {
                const result = event.results[i];
                if (result.isFinal) {
                    finalTextRef.current += result[0].transcript + ' ';
                } else {
                    interim = result[0].transcript;
                }
            }
            setInput(
                `${finalTextRef.current}${interim}`.trim()
            );
        };

        recognition.onerror = () => stopListening();

        recognition.onend = () => {
            const transcript = finalTextRef.current.trim();
            setIsListening(false);
            recognitionRef.current = null;
            finalTextRef.current = '';
            if (transcript) send(transcript);
        };

        recognition.start();
    }, [isListening, send, stopListening]);

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
                onToggleMic={toggleMic}
                isListening={isListening}
                busy={busy}
                activity={isListening ? 1 : 0}
            />
        </Box>
    );
};
