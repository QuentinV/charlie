import React from 'react';
import {
    AppBar,
    Toolbar,
    Typography,
    IconButton,
    Drawer,
    List,
    ListItem,
    ListItemText,
    Box,
    Button,
    useTheme,
    useMediaQuery,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { useNavigate } from 'react-router-dom';
import { useUnit } from 'effector-react';
import { settingsStore } from '../../state/settings';
import { NfcJsonReader } from '../NfcJsonReader';
import { $pwaPrompt, setPwaPrompt } from '../../state/standalone';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';

export const Menu = () => {
    const theme = useTheme();
    const [drawerOpen, setDrawerOpen] = React.useState(false);
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const navigate = useNavigate();
    const devicesDiscovery = useUnit(settingsStore.$devicesDiscovery);
    const enableAddRoutine = useUnit(settingsStore.$enableAddRoutine);
    const showAiAsk = useUnit(settingsStore.$showAiAsk);
    const pwaPrompt = useUnit($pwaPrompt);

    const navItems = [{ label: 'Home', route: '/' }];
    enableAddRoutine &&
        navItems.push({ label: 'Routines', route: '/routines' });
    devicesDiscovery &&
        navItems.push({ label: 'Discover', route: '/discover' });
    showAiAsk && navItems.push({ label: 'AI', route: '/ai' });
    navItems.push({ label: 'Activities', route: '/activities' });
    navItems.push({ label: 'Echos', route: '/echos' });

    return (
        <>
            <AppBar position="static">
                <Toolbar>
                    {isMobile && (
                        <IconButton
                            edge="start"
                            color="inherit"
                            aria-label="menu"
                            onClick={() => setDrawerOpen(true)}
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
                            }}
                            onClick={() => navigate('/')}
                        >
                            <img
                                src="/dark_icon.png"
                                width="30"
                                style={{ marginRight: '10px' }}
                            />
                            Charlie
                        </Typography>
                        {!!pwaPrompt && (
                            <CloudDownloadIcon
                                onClick={() => {
                                    pwaPrompt.prompt();
                                    pwaPrompt.userChoice.then(() =>
                                        setPwaPrompt(null)
                                    );
                                }}
                            />
                        )}
                    </NfcJsonReader>
                    {!isMobile &&
                        navItems.map((item, i) => (
                            <Button
                                key={i}
                                color="inherit"
                                sx={{ marginLeft: '1rem' }}
                                onClick={() => navigate(item.route)}
                            >
                                {item.label}
                            </Button>
                        ))}
                </Toolbar>
            </AppBar>
            <Drawer
                anchor="left"
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
            >
                <Box sx={{ width: 250 }} role="presentation">
                    <List>
                        {navItems.map((item, i) => (
                            <ListItem
                                key={i}
                                onClick={() => {
                                    setDrawerOpen(false);
                                    navigate(item.route);
                                }}
                            >
                                <ListItemText primary={item.label} />
                            </ListItem>
                        ))}
                    </List>
                </Box>
            </Drawer>
        </>
    );
};
