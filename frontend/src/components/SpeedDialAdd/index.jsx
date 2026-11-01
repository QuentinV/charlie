import { Box, SpeedDial, SpeedDialAction, SpeedDialIcon } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';

export const SpeedDialAdd = ({ actions = [] }) => {
    const { t } = useTranslation();
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
                ariaLabel={t('common.quickActions')}
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
