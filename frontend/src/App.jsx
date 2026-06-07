import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { theme } from './theme';
import { HomePage } from './pages/Home';
import { NotFoundPage } from './pages/NotFound';
import { Box, CircularProgress, ThemeProvider } from '@mui/material';
import { Menu } from './components/Menu';
import { Footer } from './components/Footer';
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
            <Router>
                {loadingSettings && <CircularProgress aria-label="Loading…" />}
                {!loadingSettings && (
                    <Box
                        sx={{
                            flexGrow: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            height: '100%',
                        }}
                    >
                        <Box sx={{ flexGrow: 0 }}>
                            <Menu />
                        </Box>
                        <Box
                            sx={{
                                p: 1,
                                paddingTop: 1,
                                flexGrow: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                overflow: 'auto',
                            }}
                            className="overlay"
                        >
                            <Box sx={{ height: '100%' }}>
                                <Routes>
                                    <Route path="/" element={<HomePage />} />
                                    <Route
                                        path="/discovery"
                                        element={<DiscoveryPage />}
                                    />
                                    <Route
                                        path="/room/:id"
                                        element={<RoomPage />}
                                    />
                                    <Route
                                        path="/routines"
                                        element={<RoutinesPage />}
                                    />
                                    <Route
                                        path="/routine/:id"
                                        element={<RoutineEditPage />}
                                    />
                                    <Route path="/ai" element={<AiPage />} />
                                    <Route
                                        path="/activities"
                                        element={<ActivitiesPage />}
                                    />
                                    <Route
                                        path="/echos"
                                        element={<EchoPage />}
                                    />{' '}
                                    <Route
                                        path="/dashboard"
                                        element={<DashboardPage />}
                                    />
                                    <Route
                                        path="/musics"
                                        element={<MusicsPage />}
                                    />
                                    <Route
                                        path="/settings"
                                        element={<SettingsPage />}
                                    />
                                    <Route
                                        path="/providers"
                                        element={<ProvidersPage />}
                                    />
                                    <Route
                                        path="*"
                                        element={<NotFoundPage />}
                                    />
                                </Routes>
                            </Box>
                        </Box>
                        {showAiAsk && (
                            <Box
                                sx={{
                                    flexGrow: 0,
                                    marginTop: 'auto',
                                    height: '50px',
                                    color: 'white',
                                    display: 'flex',
                                    width: '100%',
                                }}
                            >
                                <Footer />
                            </Box>
                        )}
                    </Box>
                )}
            </Router>
        </ThemeProvider>
    );
}
