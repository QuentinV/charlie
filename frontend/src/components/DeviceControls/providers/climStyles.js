/**
 * Shared visual tokens for the premium AC (Mitsubishi) control panel.
 * Mirrors the Charlie "gold on black" glassmorphism theme (see theme.jsx).
 */

// Brand gold ramp (matches theme.jsx gold/amber tokens)
export const GOLD = '#FFD700';
export const GOLD_LIGHT = '#FFE88C';
export const GOLD_DARK = '#F5B800';
export const AMBER = '#FFB300';

// Neutral glass surface (matches background.elevated of the theme)
export const SURFACE = '#18181B';

// Soft rounded-corner radius used by the glossy cards
export const LG_RADIUS = '20px';

/**
 * Build a Charlie-style box-shadow "glow".
 * @param {string} color
 * @param {number} opacity of the outer halo
 */
export const glow = (color = GOLD, opacity = 0.25) =>
    `0 0 0 1px rgba(255,215,0,${opacity * 0.5}), 0 4px 20px -4px ${color}, 0 12px 48px -12px ${color}`;