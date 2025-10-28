import React, { useState } from 'react';
import {
    Box,
    Paper,
    Typography,
    TextField,
    IconButton,
    Avatar,
    Stack,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import CloseIcon from '@mui/icons-material/Close';

export const FloatingChat = () => {
    const [isVisible, setIsVisible] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');

    const handleSend = () => {
        if (!input.trim()) return;
        setMessages([...messages, { sender: 'me', text: input }]);
        setIsVisible(true);
        setInput('');
        setTimeout(() => {
            setMessages((prev) => [
                ...prev,
                { sender: 'Charlie', text: 'Let me check that for you.' },
            ]);
        }, 600);
    };

    return (
        <>
            {isVisible && (
                <Box
                    sx={{
                        position: 'absolute',
                        display: 'flex',
                        flexDirection: 'column',
                        maxHeight: '50%',
                        bgcolor: '#ffffff9a',
                        bottom: '50px',
                        borderRadius: '10px 10px 0 0',
                        justifyContent: 'end',
                    }}
                >
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            bgcolor: '#FFB300',

                            borderRadius: '10px 10px 0 0',
                        }}
                    >
                        <Typography variant="h5" sx={{ m: 0, ml: 2 }}>
                            Assistant
                        </Typography>
                        <IconButton
                            aria-label="close"
                            onClick={() => setIsVisible(false)}
                            sx={{ marginLeft: 'auto' }}
                        >
                            <CloseIcon />
                        </IconButton>
                    </Box>
                    <Paper
                        elevation={4}
                        sx={{
                            overflowY: 'auto',
                            p: 2,
                            background: 'transparent',
                            verticalAlign: 'bottom',
                        }}
                    >
                        {messages.map((msg, i) => (
                            <Stack
                                key={i}
                                direction={
                                    msg.sender === 'me' ? 'row-reverse' : 'row'
                                }
                                spacing={1}
                                alignItems="flex-start"
                                sx={{ mb: 2 }}
                            >
                                {msg.sender !== 'me' && <Avatar>C</Avatar>}
                                <Box
                                    sx={{
                                        bgcolor:
                                            msg.sender === 'You'
                                                ? '#1976d2'
                                                : '#e0e0e0',
                                        color:
                                            msg.sender === 'You'
                                                ? '#fff'
                                                : '#000',
                                        px: 2,
                                        py: 1,
                                        borderRadius: 2,
                                        maxWidth: '100%',
                                    }}
                                >
                                    <Typography variant="body2">
                                        {msg.text}
                                    </Typography>
                                </Box>
                            </Stack>
                        ))}
                    </Paper>
                </Box>
            )}
            <Box sx={{ flex: 1, display: 'flex' }}>
                <TextField
                    label="Ask me anything"
                    variant="filled"
                    sx={{ flex: 1 }}
                    onChange={(e) => setInput(e.target.value)}
                    value={input}
                />
                <IconButton aria-label="send" onClick={handleSend}>
                    <SendIcon />
                </IconButton>
            </Box>
        </>
    );
};
