import React from 'react';
import {
    BrowserRouter as Router,
    Routes,
    Route,
    useLocation,
} from 'react-router-dom';
import { theme } from './theme';
import { HomePage } from './pages/Home';
import { NotFoundPage } from './pages/NotFound';
import {
    Box,
    Button,
    CircularProgress,
    ThemeProvider,
    CssBaseline,
    Typography,
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
import { DevicePage } from './pages/Device';
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

// Without a boundary, any uncaught error in a route (render or effect) makes
// React unmount the whole tree — i.e. a blank page. This keeps the shell and
// shows the actual error instead.
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        console.error('Page error:', error, info);
    }

    render() {
        if (this.state.error) {
            return (
                <Box
                    sx={{
                        p: 3,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        alignItems: 'flex-start',
                    }}
                >
                    <Typography variant="h6" color="error">
                        Une erreur est survenue sur cette page.
                    </Typography>
                    <Typography
                        variant="body2"
                        sx={{
                            fontFamily: 'monospace',
                            whiteSpace: 'pre-wrap',
                            opacity: 0.8,
                        }}
                    >
                        {String(
                            this.state.error?.message ?? this.state.error
                        )}
                    </Typography>
                    <Button
                        variant="outlined"
                        onClick={() => this.setState({ error: null })}
                    >
                        Réessayer
                    </Button>
                </Box>
            );
        }
        return this.props.children;
    }
}

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
    const location = useLocation();
    const isAiRoute = location.pathname === '/ai';

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
                    <ErrorBoundary key={location.pathname}>
                    <Routes>
                        <Route path="/" element={<HomePage />} />
                        <Route path="/discovery" element={<DiscoveryPage />} />
                        <Route path="/room/:id" element={<RoomPage />} />
                        <Route path="/device/:id" element={<DevicePage />} />
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
                    </ErrorBoundary>
                </Box>
            </Box>
            {showAiAsk && !isAiRoute && (
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
