import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useSetting } from '../../state/settingsHooks';

export default function EmbeddedMusicAssistant() {
    const url = useSetting('music.assistant.url');
    const sendspinUrl = useSetting('music.sendspin.url');
    if (!url) {
        return (
            <Typography>
                Missing configuration for music assistant url, please go to
                settings.
            </Typography>
        );
    }
    return (
        <>
            <Button
                sx={{ position: 'absolute', right: '2rem', top: '1rem' }}
                href={sendspinUrl}
                target="_blank"
            >
                Reconnect speaker
            </Button>
            <Box sx={{ width: '100%', height: '100%' }}>
                <iframe
                    style={{
                        width: '100%',
                        height: '100%',
                        border: 0,
                    }}
                    src={`${url}/#/home`}
                    title="Music Assistant Frontend"
                    sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
                    allow="autoplay; encrypted-media; clipboard-write"
                />
            </Box>
        </>
    );
}
