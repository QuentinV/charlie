import React, { useState } from 'react';
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
import CloseIcon from '@mui/icons-material/Close';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import MicIcon from '@mui/icons-material/Mic';

export const FloatingChat = () => {
    const [isVisible, setIsVisible] = useState(false);
    const [messages, setMessages] = useState(
        /** @type {Array<{sender: string; text: string}>} */ ([])
    );
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
                <Paper
                    elevation={24}
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        bgcolor: 'rgba(18, 18, 20, 0.95)',
                        color: 'text.primary',
                        right: { xs: 8, md: 16 },
                        left: { xs: 8, md: 'auto' },
                        width: { xs: 'auto', md: 420 },
                        borderRadius: { xs: 3, md: 4 },
                        border: '1px solid rgba(255, 215, 0, 0.15)',
                        boxShadow:
                            '0 0 0 1px rgba(255,215,0,.08), 0 24px 80px -16px rgba(0,0,0,.8)',
                        overflow: 'hidden',
                        zIndex: 1300,
                        flexGrow: 1,
                    }}
                >
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            px: 2,
                            py: 1.5,
                            bgcolor: alpha('#FFB300', 0.15),
                            borderBottom: '1px solid rgba(255,215,0,.12)',
                            backdropFilter: 'blur(12px)',
                        }}
                    >
                        <Avatar
                            sx={{
                                bgcolor: 'primary.main',
                                color: '#111',
                                width: 32,
                                height: 32,
                                mr: 1.5,
                            }}
                        >
                            <SmartToyIcon fontSize="small" />
                        </Avatar>
                        <Typography
                            variant="subtitle1"
                            sx={{ fontWeight: 700 }}
                        >
                            Assistant
                        </Typography>
                        <Box
                            sx={{
                                ml: 1,
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                bgcolor: 'success.main',
                                boxShadow: '0 0 8px rgba(76, 217, 100, .6)',
                            }}
                        />
                        <IconButton
                            aria-label="close"
                            onClick={() => setIsVisible(false)}
                            sx={{ marginLeft: 'auto' }}
                            size="small"
                        >
                            <CloseIcon fontSize="small" />
                        </IconButton>
                    </Box>
                    <Paper
                        elevation={0}
                        sx={{
                            flexGrow: 1,
                            overflowY: 'auto',
                            p: 2,
                            background: 'transparent',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 1,
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
                                Ask me anything about your home ✨
                            </Typography>
                        )}
                        {messages.map((msg, i) => (
                            <Stack
                                key={i}
                                direction={
                                    msg.sender === 'me' ? 'row-reverse' : 'row'
                                }
                                spacing={1}
                                alignItems="flex-end"
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
                                                ? 'primary.main'
                                                : alpha('#F5F5DC', 0.08),
                                        color:
                                            msg.sender === 'me'
                                                ? '#111'
                                                : 'text.primary',
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
                                                ? '0 2px 12px -2px rgba(255,215,0,.3)'
                                                : 'none',
                                    }}
                                >
                                    <Typography variant="body2">
                                        {msg.text}
                                    </Typography>
                                </Box>
                            </Stack>
                        ))}
                    </Paper>
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            p: 1.5,
                            borderTop: '1px solid rgba(255,215,0,.1)',
                            bgcolor: 'rgba(255,255,255,0.02)',
                        }}
                    >
                        <IconButton aria-label="mic" size="small">
                            <MicIcon fontSize="small" />
                        </IconButton>
                        <TextField
                            placeholder="Ask me anything"
                            variant="outlined"
                            size="small"
                            fullWidth
                            onChange={(e) => setInput(e.target.value)}
                            value={input}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSend();
                            }}
                            sx={{
                                '& .MuiOutlinedInput-root': {
                                    borderRadius: 3,
                                    bgcolor: 'rgba(10, 10, 11, 0.6)',
                                },
                            }}
                        />
                        <IconButton
                            aria-label="send"
                            onClick={handleSend}
                            sx={{
                                color: 'primary.main',
                                bgcolor: alpha('#FFD700', 0.1),
                                '&:hover': {
                                    bgcolor: alpha('#FFD700', 0.2),
                                },
                            }}
                        >
                            <SendIcon fontSize="small" />
                        </IconButton>
                    </Box>
                </Paper>
            )}
            <Box sx={{ flex: 1, display: 'flex', position: 'relative' }}>
                {!isVisible && (
                    <IconButton
                        aria-label="open chat"
                        onClick={() => setIsVisible(true)}
                        sx={{
                            position: 'absolute',
                            bottom: 8,
                            right: 0,
                            bgcolor: 'primary.main',
                            color: '#111',
                            boxShadow:
                                '0 0 0 1px rgba(255,215,0,.3), 0 4px 20px -4px rgba(255,215,0,.5)',
                            '&:hover': {
                                bgcolor: 'secondary.main',
                            },
                        }}
                    >
                        <SmartToyIcon />
                    </IconButton>
                )}
            </Box>
        </>
    );
};
