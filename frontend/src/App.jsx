import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { theme } from './theme';
import { HomePage } from './pages/Home';
import { NotFoundPage } from './pages/NotFound';
import { Box, ThemeProvider } from '@mui/material';
import { Menu } from './components/Menu';
import { Footer } from './components/Footer';
import { DevicesDiscoveryPage } from './pages/DevicesDiscovery';
import { RoutinesPage } from './pages/Routines';
import { RoomPage } from './pages/Room';
import { AiPage } from './pages/AiPage';
import Musics from './components/Musics';
import { settingsStore } from './state/settings';
import { useUnit } from 'effector-react';
import { ActivitiesPage } from './pages/Activities';
import { EchoPage } from './pages/Echo';
import { RoutineEditPage } from './pages/RoutineEdit';

export default function App() {
    const showMusicPlayer = useUnit(settingsStore.$showMusicPlayer);
    const showAiAsk = useUnit(settingsStore.$showAiAsk);
    const devicesDiscovery = useUnit(settingsStore.$devicesDiscovery);
    const echosMenu = useUnit(settingsStore.$echosMenu);
    return (
        <ThemeProvider theme={theme}>
            <Router>
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
                            p: 3,
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
                                {devicesDiscovery && (
                                    <Route
                                        path="/discovery"
                                        element={<DevicesDiscoveryPage />}
                                    />
                                )}
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
                                {echosMenu && (
                                    <Route
                                        path="/echos"
                                        element={<EchoPage />}
                                    />
                                )}
                                <Route path="*" element={<NotFoundPage />} />
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
                    {showMusicPlayer && <Musics />}
                </Box>
            </Router>
        </ThemeProvider>
    );
}
