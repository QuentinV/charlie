import React from 'react';
import { Box } from '@mui/material';
import { FloatingChat } from '../FloatingChat';
import { AddRoomButton } from '../AddRoomButton';

/**
 * Bottom action row: the add-room button sits just left of the AI chat button.
 * Each action is opt-in, so a route can show only the ones it makes sense for.
 *
 * @param {{ showAi?: boolean, showAddRoom?: boolean }} props
 */
export const Footer = ({ showAi = true, showAddRoom = true }) => {
    if (!showAi && !showAddRoom) {
        return null;
    }

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'flex-end',
                gap: 1.5,
                width: '100%',
            }}
        >
            {showAddRoom && <AddRoomButton />}
            {showAi && <FloatingChat />}
        </Box>
    );
};
