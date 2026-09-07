/**
 * Shared visual tokens + helpers for the per-device-type control panels
 * (light, switch, shutter, sprinkler, tv, sensor, thermostat, button).
 * Mirrors the Charlie "gold on black" glassmorphism theme (see theme.jsx).
 */
import { alpha } from '@mui/material/styles';

// Brand gold ramp (matches theme.jsx gold/amber tokens)
export const GOLD = '#FFD700';
export const GOLD_LIGHT = '#FFE88C';
export const GOLD_DARK = '#F5B800';
export const AMBER = '#FFB300';

// Neutral glass surface (matches background.elevated of the theme)
export const SURFACE = '#18181B';

// Per-type accent colors (mirrors Devices/Card.jsx TYPE_COLORS)
export const TYPE_COLORS = {
    light: '#FFD700',
    switch: '#FFB300',
    shutter: '#7BA7FE',
    sprinkler: '#4EC8F5',
    tv: '#4CD964',
    sensor: '#FF8F00',
    thermostat: '#FF6F00',
    button: '#B388FF',
};

/**
 * Build a Charlie-style box-shadow "glow".
 * @param {string} color
 * @param {number} opacity of the outer halo
 */
export const glow = (color = GOLD, opacity = 0.25) =>
    `0 0 0 1px rgba(255,215,0,${opacity * 0.5}), 0 4px 20px -4px ${color}, 0 12px 48px -12px ${color}`;

// Uppercase micro-label used above sections inside the panels
export const SECTION_LABEL = {
    mb: 1,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: 'text.secondary',
    fontWeight: 600,
};

/**
 * Shared circular action button (used by thermostat / shutter / tv panels).
 */
export const roundButton = (color = GOLD, { size = 46, active = false } = {}) => ({
    width: size,
    height: size,
    borderRadius: '50%',
    minWidth: 0,
    color: active ? color : 'rgba(245,245,220,0.55)',
    backgroundColor: active ? alpha(color, 0.18) : 'transparent',
    border: `1px solid ${alpha(color, 0.35)}`,
    boxShadow: active ? glow(color, 0.25) : 'none',
    transition: 'all .25s ease',
    '&:hover': {
        backgroundColor: alpha(color, 0.3),
    },
    '&.Mui-disabled': {
        opacity: 0.35,
        cursor: 'not-allowed',
    },
});