import { Box, SpeedDial, SpeedDialAction, SpeedDialIcon } from '@mui/material';
import React from 'react';

export const SpeedDialAdd = ({ actions }) => {
    return (
        <Box
            sx={{
                position: 'relative',
                height: '3rem',
            }}
        >
            <SpeedDial
                ariaLabel="SpeedDial basic example"
                sx={{
                    position: 'absolute',
                    top: 0,
                    right: 10,
                }}
                icon={<SpeedDialIcon />}
                direction="down"
            >
                {actions.map((action) => (
                    <SpeedDialAction
                        key={action.name}
                        icon={action.icon}
                        slotProps={{
                            tooltip: {
                                title: action.name,
                            },
                        }}
                        onClick={() => action.click?.()}
                    />
                ))}
            </SpeedDial>
        </Box>
    );
};
