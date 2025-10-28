import './App.css';
import { createTheme } from '@mui/material/styles';
import { grey } from '@mui/material/colors';

const goldHex = '#FFD700'; // classic gold
const goldAccent = '#FFB300'; // deeper amber-gold

export const theme = createTheme({
    palette: {
        mode: 'dark',
        primary: {
            main: goldHex,
            contrastText: '#000',
        },
        secondary: {
            main: goldAccent,
        },
        background: {
            default: '#121212',
            paper: '#1E1E1E',
        },
        text: {
            primary: '#F5F5DC', // warm beige
            secondary: grey[400],
        },
    },
    typography: {
        fontFamily: '"Roboto Condensed", "Arial Narrow", sans-serif',
        fontWeightRegular: 400,
        fontWeightMedium: 600,
        button: {
            textTransform: 'uppercase',
            fontWeight: 600,
        },
    },
    components: {
        MuiAppBar: {
            styleOverrides: {
                root: {
                    backgroundColor: '#1A1A1A',
                    borderBottom: `1px solid ${goldAccent}`,
                },
            },
        },
        MuiButton: {
            styleOverrides: {
                root: {
                    borderRadius: 8,
                    boxShadow: `0 0 5px ${goldAccent}`,
                    transition: 'all 0.3s ease-in-out',
                },
            },
        },
    },
});
