import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { theme } from './theme';
import { HomePage } from './pages/Home';
import { NotFoundPage } from './pages/NotFound';
import {
    Box,
    CircularProgress,
    ThemeProvider,
    CssBaseline,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import { Menu } from './components/Menu';
import { Footer } from './components/Footer';
import { BottomNav } from './components/BottomNav';
import { DiscoveryPage } from './pages/Discovery';
import { ProvidersPage } from './pages/Providers';
import { RoutinesPage } from './pages/Routines';
import { RoomPage } from './pages/Room';
import { AiPage } from './pages/AiPage';
import { DashboardPage } from './pages/Dashboard';
import { useUnit } from 'effector-react';
import { ActivitiesPage } from './pages/Activities';
import { EchoPage } from './pages/Echo';
import { RoutineEditPage } from './pages/RoutineEdit';
import { settings } from './state/settings';
import { useSetting } from './state/settingsHooks';
import SettingsPage from './pages/Settings';
import { MusicsPage } from './pages/Musics';

settings.loadFx();

export default function App() {
    const loadingSettings = useUnit(settings.loadFx.pending);
    const showAiAsk = useSetting('experimental.ai.ask.show');

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <Router>
                {loadingSettings && (
                    <Box
                        sx={{
                            height: '100vh',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <CircularProgress
                            aria-label="Loading..."
                            size={48}
                            thickness={4}
                        />
                    </Box>
                )}
                {!loadingSettings && <AppLayout showAiAsk={showAiAsk} />}
            </Router>
        </ThemeProvider>
    );
}

/** @param {{ showAiAsk?: boolean }} props */
function AppLayout({ showAiAsk }) {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    return (
        <Box
            sx={{
                flexGrow: 1,
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                minHeight: 0,
            }}
        >
            <Box sx={{ flexGrow: 0 }}>
                <Menu />
            </Box>
            <Box
                sx={{
                    px: { xs: 1.5, sm: 2, md: 3 },
                    py: { xs: 1.5, sm: 2 },
                    flexGrow: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'auto',
                    minHeight: 0,
                    minWidth: 0,
                    maxWidth: { md: '1200px', lg: '1400px' },
                    mx: 'auto',
                    width: '100%',
                    boxSizing: 'border-box',
                    pb: { xs: 2, sm: 2, md: 3 },
                }}
                className="overlay smooth-scroll"
            >
                <Box sx={{ flexGrow: 1, minHeight: 0 }} className="page-enter">
                    <Routes>
                        <Route path="/" element={<HomePage />} />
                        <Route path="/discovery" element={<DiscoveryPage />} />
                        <Route path="/room/:id" element={<RoomPage />} />
                        <Route path="/routines" element={<RoutinesPage />} />
                        <Route
                            path="/routine/:id"
                            element={<RoutineEditPage />}
                        />
                        <Route path="/ai" element={<AiPage />} />
                        <Route
                            path="/activities"
                            element={<ActivitiesPage />}
                        />
                        <Route path="/echos" element={<EchoPage />} />
                        <Route path="/dashboard" element={<DashboardPage />} />
                        <Route path="/musics" element={<MusicsPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                        <Route path="/providers" element={<ProvidersPage />} />
                        <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                </Box>
            </Box>
            {showAiAsk && (
                <Box
                    sx={{
                        flexGrow: 0,
                        marginTop: 'auto',
                        display: 'flex',
                        width: '100%',
                        px: { xs: 2, sm: 3 },
                        pb: { xs: 1, sm: 2 },
                        boxSizing: 'border-box',
                    }}
                >
                    <Box sx={{ width: '100%', maxWidth: 1400, mx: 'auto' }}>
                        <Footer />
                    </Box>
                </Box>
            )}
            {isMobile && <BottomNav />}
        </Box>
    );
}
