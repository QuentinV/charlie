import React from 'react';
import {
    Box,
    Paper,
    BottomNavigationAction,
    SpeedDial,
    SpeedDialAction,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import DashboardIcon from '@mui/icons-material/Dashboard';
import SettingsIcon from '@mui/icons-material/Settings';
import AddIcon from '@mui/icons-material/Add';
import ExploreIcon from '@mui/icons-material/Explore';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUnit } from 'effector-react';
import { $addActions } from '../../state/addActions';

const CORE_ITEMS = [
    { label: 'Home', icon: <HomeIcon />, route: '/' },
    { label: 'Dashboard', icon: <DashboardIcon />, route: '/dashboard' },
];

const TAIL_ITEMS = [
    { label: 'Settings', icon: <SettingsIcon />, route: '/settings' },
];

export const BottomNav = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const addActions = useUnit($addActions);
    const [fabOpen, setFabOpen] = React.useState(false);

    /**
     * @param {string} route
     */
    const isActive = (route) =>
        location.pathname === route ||
        (route !== '/' && location.pathname.startsWith(route));

    const fallbackActions = [
        {
            icon: <ExploreIcon />,
            name: 'Discover',
            click: () => navigate('/discovery'),
        },
    ];

    const menuActions = addActions.length > 0 ? addActions : fallbackActions;

    return (
        <Paper
            elevation={12}
            sx={{
                borderRadius: '20px 20px 0 0',
                background: 'rgba(18, 18, 20, 0.92)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                borderTop: '1px solid rgba(255, 215, 0, 0.1)',
                pb: 'env(safe-area-inset-bottom)',
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'stretch',
                    height: 64,
                    position: 'relative',
                }}
            >
                {CORE_ITEMS.map((item) => (
                    <BottomNavigationAction
                        key={item.route}
                        label={item.label}
                        icon={item.icon}
                        showLabel
                        onClick={() => navigate(item.route)}
                        sx={{
                            flex: 1,
                            minWidth: 0,
                            color: isActive(item.route)
                                ? 'primary.main'
                                : 'text.secondary',
                            '& .MuiBottomNavigationAction-label': {
                                fontSize: '0.65rem',
                                fontWeight: 600,
                                letterSpacing: '0.02em',
                                mt: 0.25,
                            },
                        }}
                    />
                ))}

                {/* Central FAB — opens quick-add menu */}
                <Box
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        position: 'relative',
                    }}
                >
                    <SpeedDial
                        ariaLabel="Quick add"
                        open={fabOpen}
                        onOpen={() => setFabOpen(true)}
                        onClose={() => setFabOpen(false)}
                        icon={<AddIcon />}
                        direction="up"
                        sx={{
                            position: 'absolute',
                            bottom: 4,
                            left: '50%',
                            right: 'auto',
                            transform: 'translateX(-50%)',
                            '& .MuiSpeedDial-fab': {
                                bgcolor: 'primary.main',
                                color: '#111',
                                width: 56,
                                height: 56,
                                boxShadow:
                                    '0 0 0 1px rgba(255,215,0,.25), 0 4px 20px -4px rgba(255,215,0,.5), 0 12px 48px -12px rgba(255,215,0,.4)',
                                '&:hover': {
                                    bgcolor: 'secondary.main',
                                },
                            },
                        }}
                    >
                        {menuActions.map((action) => (
                            <SpeedDialAction
                                key={action.name}
                                icon={action.icon}
                                tooltipTitle={action.name}
                                onClick={() => {
                                    setFabOpen(false);
                                    action.click?.();
                                }}
                            />
                        ))}
                    </SpeedDial>
                </Box>

                {TAIL_ITEMS.map((item) => (
                    <BottomNavigationAction
                        key={item.route}
                        label={item.label}
                        icon={item.icon}
                        showLabel
                        onClick={() => navigate(item.route)}
                        sx={{
                            flex: 1,
                            minWidth: 0,
                            color: isActive(item.route)
                                ? 'primary.main'
                                : 'text.secondary',
                            '& .MuiBottomNavigationAction-label': {
                                fontSize: '0.65rem',
                                fontWeight: 600,
                                letterSpacing: '0.02em',
                                mt: 0.25,
                            },
                        }}
                    />
                ))}
            </Box>
        </Paper>
    );
};

export default BottomNav;
