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
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import AppsIcon from '@mui/icons-material/Apps';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import DocumentScannerIcon from '@mui/icons-material/DocumentScanner';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSetting } from '../../state/settingsHooks';

const CORE_ITEMS = [
    { labelKey: 'nav.home', icon: <HomeIcon />, route: '/' },
    { labelKey: 'nav.dashboard', icon: <DashboardIcon />, route: '/dashboard' },
];

const TAIL_ITEMS = [
    {
        labelKey: 'nav.automations',
        icon: <AccountTreeIcon />,
        route: '/automations',
    },
];

export const BottomNav = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const musicsEnabled = useSetting('musics.show');
    const shoppingEnabled = useSetting('shopping.enabled', true);
    const visionEnabled = useSetting('vision.enabled', true);
    const [fabOpen, setFabOpen] = React.useState(false);

    /**
     * @param {string} route
     */
    const isActive = (route) =>
        location.pathname === route ||
        (route !== '/' && location.pathname.startsWith(route));

    // Skills shortcuts — gated by the same feature flags as their menu entries.
    const skills = React.useMemo(() => {
        /** @type {Array<{labelKey: string; route: string; icon: React.ReactNode}>} */
        const items = [];
        if (musicsEnabled)
            items.push({
                labelKey: 'nav.musics',
                route: '/musics',
                icon: <MusicNoteIcon />,
            });
        if (shoppingEnabled)
            items.push({
                labelKey: 'nav.shopping',
                route: '/shopping',
                icon: <ShoppingCartIcon />,
            });
        if (visionEnabled)
            items.push({
                labelKey: 'nav.vision',
                route: '/vision',
                icon: <DocumentScannerIcon />,
            });
        // Recettes has no feature flag: it is part of the home, not a module.
        items.push({
            labelKey: 'nav.recipes',
            route: '/recipes',
            icon: <MenuBookIcon />,
        });
        return items;
    }, [musicsEnabled, shoppingEnabled, visionEnabled]);

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
                        label={t(item.labelKey)}
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

                {/* Central FAB — skills shortcuts (music, shopping, scan) */}
                {skills.length > 0 && (
                    <Box
                        sx={{
                            flex: 1,
                            minWidth: 0,
                            position: 'relative',
                        }}
                    >
                        <SpeedDial
                            ariaLabel={t('nav.skills')}
                            open={fabOpen}
                            onOpen={() => setFabOpen(true)}
                            onClose={() => setFabOpen(false)}
                            icon={<AppsIcon />}
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
                                // Skill actions share the gold surface, so their
                                // icons are black like the main FAB's.
                                '& .MuiSpeedDialAction-fab': {
                                    bgcolor: 'primary.main',
                                    color: '#111',
                                    '&:hover': {
                                        bgcolor: 'secondary.main',
                                    },
                                },
                            }}
                        >
                            {skills.map((skill) => (
                                <SpeedDialAction
                                    key={skill.route}
                                    icon={skill.icon}
                                    slotProps={{
                                        tooltip: {
                                            title: t(skill.labelKey),
                                        },
                                    }}
                                    onClick={() => {
                                        setFabOpen(false);
                                        navigate(skill.route);
                                    }}
                                />
                            ))}
                        </SpeedDial>
                    </Box>
                )}

                {TAIL_ITEMS.map((item) => (
                    <BottomNavigationAction
                        key={item.route}
                        label={t(item.labelKey)}
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
