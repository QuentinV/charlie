import React from 'react';
import {
    Box,
    Card,
    CardContent,
    Typography,
    alpha,
    useTheme,
} from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import BoltIcon from '@mui/icons-material/Bolt';
import { DeviceIcon } from '../DeviceIcon';
import { DeviceToggle } from './Toggle';
import { DeviceType } from './constants';
import { useLongPress } from '../../hooks/useLongPress';

const TYPE_COLORS = {
    [DeviceType.light]: '#FFD700',
    [DeviceType.switch]: '#FFB300',
    [DeviceType.shutter]: '#7BA7FE',
    [DeviceType.sprinkler]: '#4EC8F5',
    [DeviceType.tv]: '#4CD964',
    [DeviceType.sensor]: '#FF8F00',
    [DeviceType.thermostat]: '#FF6F00',
    [DeviceType.button]: '#B388FF',
};

/**
 * @param {{
 *   device: any;
 *   onSelect?: (device: any) => void;
 *   compact?: boolean;
 *   favorite?: boolean;
 *   onToggleFavorite?: (device: any) => void;
 * }} props
 */
export const DeviceCard = ({
    device,
    onSelect,
    compact = false,
    favorite = false,
    onToggleFavorite,
}) => {
    const theme = useTheme();
    const isOn = device?.state?.power === 'on';
    const color = TYPE_COLORS[device?.type] ?? theme.palette.text.secondary;

    /** @type {React.MutableRefObject<boolean>} */
    const suppressClickRef = React.useRef(false);

    const longPressProps = useLongPress(() => {
        suppressClickRef.current = true;
        onToggleFavorite?.(device);
    });

    return (
        <Card
            onClick={() => {
                if (suppressClickRef.current) {
                    // Long-press just fired — don't open details
                    suppressClickRef.current = false;
                    return;
                }
                onSelect?.(device);
            }}
            className={isOn ? 'card-on' : ''}
            {...longPressProps}
            sx={{
                height: '100%',
                cursor: 'pointer',
                touchAction: 'pan-y',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                bgcolor: 'transparent',
                border: `1px solid ${
                    isOn ? alpha(color, 0.35) : theme.palette.divider
                }`,
                boxShadow: isOn ? `0 0 24px -8px ${alpha(color, 0.4)}` : 'none',
                transition: 'transform .18s ease, box-shadow .25s ease',
                '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: `0 8px 32px -8px ${alpha(color, 0.25)}`,
                },
            }}
        >
            <CardContent
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: compact ? 0.625 : 1.25,
                    p: compact ? '0.5rem 0.75rem' : { xs: 1.5, sm: 2 },
                    '&:last-child': {
                        pb: compact ? '0.5rem' : undefined,
                    },
                }}
            >
                {/* Left: icon (full height, vertically centered) */}
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: compact ? 32 : 40,
                        height: compact ? 32 : 40,
                        borderRadius: compact ? 9 : 12,
                        bgcolor: alpha(color, 0.12),
                        color: color,
                        flexShrink: 0,
                    }}
                >
                    <DeviceIcon type={device?.type} color={color} />
                </Box>

                {/* Right: name (line 1) + state & toggle (line 2) */}
                <Box
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: compact ? 0.25 : 0.625,
                    }}
                >
                    {/* Line 1: name + favorite star */}
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                            minWidth: 0,
                        }}
                    >
                        <Typography
                            variant={compact ? 'body2' : 'subtitle1'}
                            noWrap
                            sx={{
                                fontWeight: 600,
                                lineHeight: 1.3,
                                flex: 1,
                                minWidth: 0,
                            }}
                        >
                            {device?.name}
                        </Typography>
                        {favorite && (
                            <StarIcon
                                sx={{
                                    fontSize: compact ? 14 : 18,
                                    color: 'primary.main',
                                    flexShrink: 0,
                                }}
                            />
                        )}
                    </Box>

                    {/* Line 2: state + toggle */}
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: compact ? 0.5 : 1,
                            minWidth: 0,
                        }}
                    >
                        <BoltIcon
                            sx={{
                                fontSize: compact ? 16 : 18,
                                color: isOn ? color : 'text.disabled',
                                opacity: isOn ? 1 : 0.5,
                                flexShrink: 0,
                                filter: isOn
                                    ? `drop-shadow(0 0 4px ${alpha(color, 0.6)})`
                                    : 'none',
                            }}
                        />
                        <Box sx={{ flexShrink: 0 }}>
                            <DeviceToggle
                                deviceId={device?._id}
                                power={device?.state?.power}
                                type={device?.type}
                                level={device?.state?.level}
                                compact={compact}
                                onStateChange={(
                                    /**
                                     * @type {any}
                                     */ newState
                                ) => {
                                    if (newState) {
                                        device.state = newState;
                                        onSelect?.({ ...device });
                                    }
                                }}
                            />
                        </Box>
                    </Box>
                </Box>
            </CardContent>
        </Card>
    );
};
