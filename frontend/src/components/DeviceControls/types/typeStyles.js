/**
 * Shared visual tokens + helpers for the per-device-type control panels
 * (light, switch, shutter, sprinkler, tv, sensor, thermostat, button).
 * Mirrors the Charlie "gold on black" glassmorphism theme (see theme.jsx).
 */
import { alpha } from '@mui/material/styles';
import { GOLD, glow } from '../primitives/tokens';

// Tokens live in `primitives/tokens.js` (single source of truth) and are
// re-exported here so existing panels keep importing them from this module.
export {
    GOLD,
    GOLD_LIGHT,
    GOLD_DARK,
    AMBER,
    SURFACE,
    CARD_RADIUS,
    glow,
} from '../primitives/tokens';

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