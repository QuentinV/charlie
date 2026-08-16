import { Box, SpeedDial, SpeedDialAction, SpeedDialIcon } from '@mui/material';
import React from 'react';

export const SpeedDialAdd = ({ actions = [] }) => {
    return (
        <Box
            sx={{
                position: 'relative',
                height: '3rem',
                display: 'flex',
                justifyContent: 'flex-end',
            }}
        >
            <SpeedDial
                ariaLabel="Quick actions"
                sx={{
                    position: 'absolute',
                    top: 0,
                    right: 10,
                }}
                icon={<SpeedDialIcon />}
                direction="down"
                FabProps={{
                    size: 'medium',
                }}
            >
                {actions.map((action) => (
                    <SpeedDialAction
                        key={action.name}
                        icon={action.icon}
                        slotProps={{
                            tooltip: {
                                title: action.name,
                                placement: 'left',
                            },
                        }}
                        onClick={() => action.click?.()}
                    />
                ))}
            </SpeedDial>
        </Box>
    );
};
