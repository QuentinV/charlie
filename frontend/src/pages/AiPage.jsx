import React from 'react';
import { Box, Typography } from '@mui/material';
import TauVisualizer from '../components/AIAvatar/TauVisualizer';

export const AiPage = () => (
    <>
        <Box
            sx={{
                display: 'flex',
                flexWrap: 'wrap',
                width: '100%',
                height: '100%',
            }}
        >
            <TauVisualizer />
        </Box>
    </>
);
