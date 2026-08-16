import React from 'react';
import {
    AppBar,
    Toolbar,
    Typography,
    IconButton,
    Drawer,
    Box,
    Button,
    useTheme,
    useMediaQuery,
    alpha,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import HomeIcon from '@mui/icons-material/Home';
import DashboardIcon from '@mui/icons-material/Dashboard';
import AutoModeIcon from '@mui/icons-material/AutoMode';
import ExploreIcon from '@mui/icons-material/Explore';
import RouterIcon from '@mui/icons-material/Router';
import ChatIcon from '@mui/icons-material/Chat';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import HistoryIcon from '@mui/icons-material/History';
import SpeakerIcon from '@mui/icons-material/Speaker';
import SettingsIcon from '@mui/icons-material/Settings';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUnit } from 'effector-react';
import { NfcJsonReader } from '../NfcJsonReader';
import { $pwaPrompt, setPwaPrompt } from '../../state/standalone';
import { useSetting } from '../../state/settingsHooks';

export const Menu = () => {
    const theme = useTheme();
    const [drawerOpen, setDrawerOpen] = React.useState(false);
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const navigate = useNavigate();
    const location = useLocation();
    const enableAddRoutine = useSetting('routines.enabled');
    const showAiAsk = useSetting('experimental.ai.ask.show');
    const pwaPrompt = useUnit($pwaPrompt);
    const devicesDiscovery = useSetting(
        'experimental.devices.discovery.enabled'
    );
    const echosMenu = useSetting('echos.menu.enabled', true);

    const navItems = [
        { label: 'Home', route: '/', icon: <HomeIcon fontSize="small" /> },
        {
            label: 'Dashboard',
            route: '/dashboard',
            icon: <DashboardIcon fontSize="small" />,
        },
    ];

    enableAddRoutine &&
        navItems.push({
            label: 'Routines',
            route: '/routines',
            icon: <AutoModeIcon fontSize="small" />,
        });

    devicesDiscovery &&
        navItems.push({
            label: 'Discover',
            route: '/discovery',
            icon: <ExploreIcon fontSize="small" />,
        });

    navItems.push({
        label: 'Providers',
        route: '/providers',
        icon: <RouterIcon fontSize="small" />,
    });

    showAiAsk &&
        navItems.push({
            label: 'AI',
            route: '/ai',
            icon: <ChatIcon fontSize="small" />,
        });

    useSetting('musics.show') &&
        navItems.push({
            label: 'Musics',
            route: '/musics',
            icon: <MusicNoteIcon fontSize="small" />,
        });

    navItems.push({
        label: 'Activities',
        route: '/activities',
        icon: <HistoryIcon fontSize="small" />,
    });

    echosMenu &&
        navItems.push({
            label: 'Echos',
            route: '/echos',
            icon: <SpeakerIcon fontSize="small" />,
        });

    navItems.push({
        label: 'Settings',
        route: '/settings',
        icon: <SettingsIcon fontSize="small" />,
    });

    return (
        <>
            <AppBar position="static">
                <Toolbar sx={{ gap: 0.5 }}>
                    {isMobile && (
                        <IconButton
                            edge="start"
                            color="inherit"
                            aria-label="menu"
                            onClick={() => setDrawerOpen(true)}
                            sx={{
                                borderRadius: 2,
                                '&:hover': {
                                    backgroundColor: alpha(
                                        theme.palette.primary.main,
                                        0.1
                                    ),
                                },
                            }}
                        >
                            <MenuIcon />
                        </IconButton>
                    )}
                    <NfcJsonReader>
                        <Typography
                            variant="h6"
                            sx={{
                                flexGrow: 1,
                                display: 'flex',
                                alignItems: 'center',
                                cursor: 'pointer',
                                fontWeight: 700,
                                letterSpacing: '0.01em',
                                gap: 1.5,
                            }}
                            onClick={() => navigate('/')}
                        >
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                }}
                            >
                                <img
                                    src="/dark_icon_short.png"
                                    width="32"
                                    height="32"
                                    style={{ borderRadius: 8 }}
                                />
                                <Box
                                    component="span"
                                    sx={{
                                        background:
                                            'linear-gradient(120deg, #FFD700 20%, #FFB300 80%)',
                                        WebkitBackgroundClip: 'text',
                                        WebkitTextFillColor: 'transparent',
                                        backgroundClip: 'text',
                                        fontSize: '1.15rem',
                                    }}
                                >
                                    Charlie
                                </Box>
                            </Box>
                        </Typography>
                        {!!pwaPrompt && (
                            <IconButton
                                size="small"
                                color="primary"
                                onClick={() => {
                                    const evt = pwaPrompt;
                                    if (evt?.prompt) {
                                        evt.prompt();
                                        evt.userChoice?.then(() =>
                                            setPwaPrompt()
                                        );
                                    }
                                }}
                                aria-label="Install app"
                            >
                                <CloudDownloadIcon fontSize="small" />
                            </IconButton>
                        )}
                    </NfcJsonReader>
                    {!isMobile &&
                        navItems.map((item, i) => {
                            const isActive =
                                location.pathname === item.route ||
                                (item.route !== '/' &&
                                    location.pathname.startsWith(item.route));
                            return (
                                <Button
                                    key={i}
                                    color="inherit"
                                    size="small"
                                    sx={{
                                        marginLeft: '0.25rem',
                                        borderRadius: 2,
                                        px: 1.5,
                                        py: 0.75,
                                        color: isActive
                                            ? 'primary.main'
                                            : 'text.primary',
                                        backgroundColor: isActive
                                            ? alpha(
                                                  theme.palette.primary.main,
                                                  0.1
                                              )
                                            : 'transparent',
                                        fontWeight: isActive ? 700 : 500,
                                        '&:hover': {
                                            backgroundColor: alpha(
                                                theme.palette.primary.main,
                                                0.08
                                            ),
                                        },
                                    }}
                                    onClick={() => navigate(item.route)}
                                >
                                    {item.icon}
                                    <Box component="span" sx={{ ml: 0.75 }}>
                                        {item.label}
                                    </Box>
                                </Button>
                            );
                        })}
                </Toolbar>
            </AppBar>
            <Drawer
                anchor="left"
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                PaperProps={{
                    sx: {
                        width: 280,
                        borderRadius: '0 20px 20px 0',
                        backgroundImage:
                            'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 50%)',
                    },
                }}
            >
                <Box sx={{ width: 280 }} role="presentation">
                    <Box
                        sx={{
                            px: 3,
                            py: 2.5,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                        }}
                    >
                        <img
                            src="/dark_icon_short.png"
                            width="40"
                            height="40"
                            style={{ borderRadius: 12 }}
                        />
                        <Box>
                            <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                Charlie
                            </Typography>
                            <Typography
                                variant="caption"
                                sx={{ color: 'text.secondary' }}
                            >
                                Home Assistant
                            </Typography>
                        </Box>
                    </Box>
                    <Box sx={{ px: 1.5, pb: 2 }}>
                        {navItems.map((item, i) => {
                            const isActive =
                                location.pathname === item.route ||
                                (item.route !== '/' &&
                                    location.pathname.startsWith(item.route));
                            return (
                                <Button
                                    key={i}
                                    fullWidth
                                    startIcon={item.icon}
                                    onClick={() => {
                                        setDrawerOpen(false);
                                        navigate(item.route);
                                    }}
                                    sx={{
                                        justifyContent: 'flex-start',
                                        mb: 0.5,
                                        borderRadius: 2,
                                        px: 2,
                                        color: isActive
                                            ? 'primary.main'
                                            : 'text.secondary',
                                        backgroundColor: isActive
                                            ? alpha(
                                                  theme.palette.primary.main,
                                                  0.1
                                              )
                                            : 'transparent',
                                        fontWeight: isActive ? 700 : 500,
                                        '&:hover': {
                                            backgroundColor: alpha(
                                                theme.palette.primary.main,
                                                0.08
                                            ),
                                        },
                                    }}
                                >
                                    {item.label}
                                </Button>
                            );
                        })}
                    </Box>
                </Box>
            </Drawer>
        </>
    );
};
