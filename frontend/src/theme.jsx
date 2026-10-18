import './App.css';
import { createTheme, alpha } from '@mui/material/styles';

// ─── Color Tokens — "Charlie Gold" ────────────────────────────────
const gold = {
    50: '#FFFBEB',
    100: '#FFF3C4',
    200: '#FFE88C',
    300: '#FFD700', // signature gold
    400: '#FFC300',
    500: '#F5B800',
    600: '#D9A000',
    700: '#B8860B',
    800: '#8B6E00',
    900: '#6E5600',
};

const amber = {
    50: '#FFF8E1',
    100: '#FFECB3',
    200: '#FFE082',
    300: '#FFD54F',
    400: '#FFCA28',
    500: '#FFB300', // signature amber
    600: '#FFA000',
    700: '#FF8F00',
    800: '#FF6F00',
    900: '#E65100',
};

// ================================================================
//  SURFACE / TEXT TOKENS
// ================================================================
const background = {
    default: '#0A0A0B',
    paper: '#121214',
    elevated: '#18181B',
    overlay: 'rgba(10, 10, 11, 0.82)',
};

const beige = {
    primary: '#F5F5DC',
    secondary: 'rgba(245, 245, 220, 0.72)',
    disabled: 'rgba(245, 245, 220, 0.38)',
    hint: 'rgba(245, 245, 220, 0.5)',
};

// ================================================================
// DIMENSIONS
// ================================================================
const radii = {
    xs: 6,
    sm: 8,
    md: 14,
    lg: 20,
    xl: 28,
    pill: 999,
};

const glow = (color, opacity = 0.25) =>
    `0 0 0 1px ${alpha(color, opacity * 0.5)}, 0 4px 20px -4px ${alpha(color, opacity)}, 0 12px 48px -12px ${alpha(color, opacity * 0.6)}`;

export const theme = createTheme({
    palette: {
        mode: 'dark',
        primary: {
            main: gold[300],
            light: gold[100],
            dark: gold[500],
            contrastText: '#111111',
        },
        secondary: {
            main: amber[500],
            light: amber[300],
            dark: amber[700],
            contrastText: '#111111',
        },
        background: {
            default: background.default,
            paper: background.paper,
        },
        text: {
            primary: beige.primary,
            secondary: beige.secondary,
            disabled: beige.disabled,
        },
        divider: 'rgba(255, 215, 0, 0.12)',
        success: {
            main: '#4CD964',
            light: '#6FE98A',
            dark: '#2BA74A',
            contrastText: '#0A0A0B',
        },
        warning: {
            main: amber[400],
            dark: amber[700],
            contrastText: '#111111',
        },
        error: {
            main: '#FF5D5D',
            light: '#FF8B8B',
            dark: '#C93030',
            contrastText: '#111111',
        },
        info: {
            main: '#4EC8F5',
            light: '#7DDBFF',
            dark: '#259FD0',
            contrastText: '#0A0A0B',
        },
    },

    shape: {
        borderRadius: radii.md,
    },

    typography: {
        fontFamily:
            '"Roboto Condensed", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
        fontWeightLight: 300,
        fontWeightRegular: 400,
        fontWeightMedium: 600,
        fontWeightBold: 700,
        h1: { fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.02em' },
        h2: { fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.01em' },
        h3: { fontSize: '1.625rem', fontWeight: 700 },
        h4: { fontSize: '1.375rem', fontWeight: 700 },
        h5: { fontSize: '1.125rem', fontWeight: 600 },
        h6: { fontSize: '1rem', fontWeight: 600 },
        subtitle1: {
            fontSize: '0.9375rem',
            fontWeight: 500,
            letterSpacing: '0.01em',
        },
        subtitle2: {
            fontSize: '0.875rem',
            fontWeight: 500,
            letterSpacing: '0.01em',
        },
        body1: { fontSize: '0.9375rem', lineHeight: 1.55 },
        body2: { fontSize: '0.8125rem', lineHeight: 1.5 },
        caption: {
            fontSize: '0.75rem',
            fontWeight: 400,
            letterSpacing: '0.03em',
        },
        button: {
            textTransform: 'none',
            fontWeight: 600,
            letterSpacing: '0.02em',
        },
    },

    // ============================================================
    //  COMPONENT OVERRIDES — Modern, tactile, gold-accented
    // ============================================================
    components: {
        MuiCssBaseline: {
            styleOverrides: {
                '*::-webkit-scrollbar': {
                    width: 6,
                    height: 6,
                },
                '*::-webkit-scrollbar-track': {
                    background: 'transparent',
                },
                '*::-webkit-scrollbar-thumb': {
                    background: alpha(gold[700], 0.4),
                    borderRadius: radii.pill,
                    '&:hover': {
                        background: alpha(gold[600], 0.6),
                    },
                },
            },
        },

        MuiAppBar: {
            styleOverrides: {
                root: {
                    backgroundColor: 'rgba(10, 10, 11, 0.5)',
                    backgroundImage:
                        'linear-gradient(180deg, rgba(58, 48, 26, 0.82) 0%, rgba(10, 10, 11, 0.55) 100%)',
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                    borderBottom: `1px solid ${alpha(gold[300], 0.22)}`,
                    boxShadow:
                        '0 1px 0 rgba(255, 215, 0, 0.06), 0 0 24px -8px rgba(255, 215, 0, 0.28)',
                },
            },
        },

        MuiToolbar: {
            styleOverrides: {
                root: {
                    minHeight: '56px',
                    '@media (min-width: 600px)': {
                        minHeight: '64px',
                    },
                },
            },
        },

        MuiButton: {
            defaultProps: {
                disableElevation: true,
            },
            styleOverrides: {
                root: {
                    borderRadius: radii.sm,
                    padding: '8px 18px',
                    fontWeight: 600,
                    transition:
                        'transform .15s ease, box-shadow .2s ease, background-color .2s ease',
                    '&:active': {
                        transform: 'scale(0.97)',
                    },
                },
                containedPrimary: {
                    background: `linear-gradient(135deg, ${gold[200]} 0%, ${gold[300]} 50%, ${gold[500]} 100%)`,
                    color: '#111',
                    '&:hover': {
                        background: `linear-gradient(135deg, ${gold[100]} 0%, ${gold[300]} 60%, ${gold[600]} 100%)`,
                        boxShadow: glow(gold[300], 0.35),
                    },
                },
                containedSecondary: {
                    background: `linear-gradient(135deg, ${amber[400]} 0%, ${amber[600]} 100%)`,
                    color: '#111',
                    '&:hover': {
                        boxShadow: glow(amber[500], 0.3),
                    },
                },
                outlinedPrimary: {
                    borderColor: alpha(gold[300], 0.5),
                    color: gold[200],
                    '&:hover': {
                        borderColor: gold[300],
                        backgroundColor: alpha(gold[300], 0.08),
                        boxShadow: glow(gold[300], 0.12),
                    },
                },
                textPrimary: {
                    color: gold[200],
                    '&:hover': {
                        backgroundColor: alpha(gold[300], 0.08),
                    },
                },
            },
        },

        MuiFab: {
            styleOverrides: {
                root: {
                    background:
                        'linear-gradient(135deg, #FFD700 0%, #FFB300 100%)',
                    color: '#111',
                    boxShadow: glow(gold[300], 0.4),
                    '&:hover': {
                        background:
                            'linear-gradient(135deg, #FFE142 0%, #FFC300 100%)',
                        boxShadow: glow(gold[300], 0.5),
                    },
                },
            },
        },

        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                },
            },
        },

        MuiCard: {
            styleOverrides: {
                root: {
                    backgroundColor: background.elevated,
                    backgroundImage:
                        'linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0) 60%)',
                    border: `1px solid ${alpha(gold[300], 0.08)}`,
                    borderRadius: radii.lg,
                    transition:
                        'transform .2s ease, box-shadow .25s ease, border-color .2s ease',
                    '&:hover': {
                        borderColor: alpha(gold[300], 0.22),
                        boxShadow: glow(gold[300], 0.08),
                    },
                },
            },
        },

        MuiListItem: {
            styleOverrides: {
                root: {
                    borderRadius: radii.md,
                    transition: 'background-color .15s ease',
                    '&:hover': {
                        backgroundColor: alpha(gold[300], 0.04),
                    },
                },
            },
        },

        MuiListItemButton: {
            styleOverrides: {
                root: {
                    borderRadius: radii.md,
                    transition: 'background-color .15s ease',
                    '&:hover': {
                        backgroundColor: alpha(gold[300], 0.04),
                    },
                    '&.Mui-selected': {
                        backgroundColor: alpha(gold[300], 0.12),
                        '&:hover': {
                            backgroundColor: alpha(gold[300], 0.16),
                        },
                    },
                },
            },
        },

        MuiSwitch: {
            styleOverrides: {
                root: {
                    '& .MuiSwitch-switchBase.Mui-checked': {
                        color: gold[300],
                        '&:hover': {
                            backgroundColor: alpha(gold[300], 0.08),
                        },
                    },
                    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                        backgroundColor: gold[600],
                        opacity: 0.65,
                    },
                },
                track: {
                    backgroundColor: alpha(beige.primary, 0.25),
                    borderRadius: radii.pill,
                },
                thumb: {
                    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                },
            },
        },

        MuiChip: {
            styleOverrides: {
                root: {
                    borderRadius: radii.pill,
                    fontWeight: 600,
                },
                outlined: {
                    borderColor: alpha(gold[300], 0.3),
                    color: gold[200],
                },
                filled: {
                    backgroundColor: alpha(gold[300], 0.12),
                    color: gold[200],
                },
            },
        },

        MuiAlert: {
            styleOverrides: {
                root: {
                    borderRadius: radii.md,
                    backdropFilter: 'blur(12px)',
                },
                filledSuccess: {
                    backgroundColor: '#12351F',
                    color: '#B3F5C5',
                },
                filledError: {
                    backgroundColor: '#3E1515',
                    color: '#FFC2C2',
                },
                filledWarning: {
                    backgroundColor: '#3A2C0E',
                    color: '#FFE5A6',
                },
                filledInfo: {
                    backgroundColor: '#10303E',
                    color: '#BFE8FF',
                },
            },
        },

        MuiDialog: {
            styleOverrides: {
                paper: {
                    borderRadius: radii.xl,
                    backgroundColor: background.overlay,
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                },
                paperFullScreen: {
                    backgroundColor: background.default,
                    borderRadius: 0,
                },
            },
        },

        MuiBackdrop: {
            styleOverrides: {
                root: {
                    backgroundColor: 'rgba(3, 3, 4, 0.72)',
                    backdropFilter: 'blur(6px)',
                    WebkitBackdropFilter: 'blur(6px)',
                },
            },
        },

        MuiDrawer: {
            styleOverrides: {
                paper: {
                    backgroundColor: background.elevated,
                    backgroundImage:
                        'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 50%)',
                },
            },
        },

        MuiTextField: {
            styleOverrides: {
                root: {
                    '& .MuiOutlinedInput-root': {
                        borderRadius: radii.md,
                        backgroundColor: alpha(background.default, 0.5),
                        transition:
                            'border-color .2s ease, box-shadow .2s ease',
                        '&:hover': {
                            backgroundColor: alpha(background.default, 0.8),
                        },
                        '&.Mui-focused': {
                            boxShadow: `0 0 0 3px ${alpha(gold[300], 0.12)}`,
                        },
                        '& fieldset': {
                            borderColor: alpha(beige.primary, 0.12),
                        },
                        '&:hover fieldset': {
                            borderColor: alpha(gold[300], 0.35),
                        },
                        '&.Mui-focused fieldset': {
                            borderColor: alpha(gold[300], 0.6),
                        },
                    },
                    '& .MuiFilledInput-root': {
                        borderRadius: radii.md,
                        backgroundColor: alpha(background.default, 0.5),
                        '&:hover': {
                            backgroundColor: alpha(background.default, 0.8),
                        },
                        '&.Mui-focused': {
                            boxShadow: `0 0 0 3px ${alpha(gold[300], 0.12)}`,
                        },
                    },
                },
            },
        },

        MuiSlider: {
            styleOverrides: {
                root: {
                    color: gold[300],
                    height: 6,
                    '& .MuiSlider-thumb': {
                        width: 18,
                        height: 18,
                        boxShadow: `0 0 0 4px ${alpha(gold[300], 0.15)}`,
                        transition: 'box-shadow .2s ease',
                        '&:hover, &.Mui-focusVisible': {
                            boxShadow: `0 0 0 6px ${alpha(gold[300], 0.25)}`,
                        },
                        '&:active': {
                            boxShadow: `0 0 0 10px ${alpha(gold[300], 0.3)}`,
                        },
                    },
                    '& .MuiSlider-rail': {
                        backgroundColor: alpha(beige.primary, 0.15),
                    },
                },
            },
        },

        MuiTab: {
            styleOverrides: {
                root: {
                    textTransform: 'none',
                    fontWeight: 600,
                    '&.Mui-selected': {
                        color: gold[200],
                    },
                },
            },
        },

        MuiTabs: {
            styleOverrides: {
                indicator: {
                    backgroundColor: gold[300],
                    height: 3,
                    borderRadius: radii.pill,
                },
            },
        },

        MuiSpeedDial: {
            styleOverrides: {
                fab: {
                    boxShadow: glow(gold[300], 0.4),
                },
            },
        },

        MuiLinearProgress: {
            styleOverrides: {
                root: {
                    borderRadius: radii.pill,
                    backgroundColor: alpha(beige.primary, 0.08),
                },
                bar: {
                    borderRadius: radii.pill,
                    background:
                        'linear-gradient(90deg, #FFD700 0%, #FFB300 100%)',
                },
            },
        },

        MuiCircularProgress: {
            styleOverrides: {
                root: {
                    color: gold[300],
                },
            },
        },

        MuiSkeleton: {
            styleOverrides: {
                root: {
                    background: alpha(beige.primary, 0.06),
                    '&::after': {
                        background:
                            'linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.08), transparent)',
                    },
                },
            },
        },
    },
});
