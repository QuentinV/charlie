import React from 'react';
import { Box, IconButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/charlie';
import { KIND_COLORS, layoutAutomations } from './layout';

/**
 * Read-only automations graph.
 *
 * One SVG picture of every automation (a band each), with pan/zoom. It only
 * draws what the engine would walk: trigger → condition → action → notify; the
 * band title is the automation name. Editing is out of scope (P2).
 */
export default function AutomationGraph({ automations }) {
    const { t } = useTranslation();
    const [devices, setDevices] = React.useState([]);

    React.useEffect(() => {
        let alive = true;
        api('devices').then((res) => {
            if (alive) setDevices(Array.isArray(res) ? res : []);
        });
        return () => {
            alive = false;
        };
    }, []);

    const deviceName = React.useMemo(() => {
        const map = new Map((devices ?? []).map((d) => [d._id, d.name]));
        return (node) =>
            map.get(
                node?.trigger?.device?.deviceId ?? node?.condition?.deviceId
            );
    }, [devices]);

    const { bands, nodes, links, bounds } = React.useMemo(
        () => layoutAutomations(automations, deviceName),
        [automations, deviceName]
    );

    const [view, setView] = React.useState({ scale: 1, tx: 0, ty: 0 });
    const svgRef = React.useRef(null);
    const drag = React.useRef(null);

    const cx = bounds.width / 2;
    const cy = bounds.height / 2;
    const reset = () => setView({ scale: 1, tx: 0, ty: 0 });

    // Wheel zoom — native listener so preventDefault is honoured.
    React.useEffect(() => {
        const el = svgRef.current;
        if (!el) return;
        const onWheel = (e) => {
            e.preventDefault();
            setView((v) => ({
                ...v,
                scale: Math.min(
                    3,
                    Math.max(0.3, v.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12))
                ),
            }));
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, []);

    const onPointerDown = (e) => {
        if (e.button !== 0) return;
        drag.current = {
            x: e.clientX,
            y: e.clientY,
            tx: view.tx,
            ty: view.ty,
        };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e) => {
        // Capture the gesture start NOW: the `setView` updater below runs later
        // (during React's render phase), by which time a `pointerup` may already
        // have nulled `drag.current`. Reading the ref inside the updater threw
        // "Cannot read properties of null (reading 'tx')" and crashed the page.
        const start = drag.current;
        const el = svgRef.current;
        if (!start || !el) return;
        const rect = el.getBoundingClientRect();
        const dx =
            (e.clientX - start.x) * (bounds.width / Math.max(rect.width, 1));
        const dy =
            (e.clientY - start.y) * (bounds.height / Math.max(rect.height, 1));
        setView((v) => ({
            ...v,
            tx: start.tx + dx,
            ty: start.ty + dy,
        }));
    };
    const onPointerUp = () => {
        drag.current = null;
    };

    const transform =
        `translate(${view.tx} ${view.ty}) ` +
        `translate(${cx} ${cy}) scale(${view.scale}) translate(${-cx} ${-cy})`;

    if (!automations?.length) {
        return null;
    }

    return (
        <Box
            sx={{
                position: 'relative',
                width: '100%',
                height: { xs: 380, md: 560 },
                borderRadius: 4,
                overflow: 'hidden',
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: '#0A0A0B',
            }}
        >
            <svg
                ref={svgRef}
                width="100%"
                height="100%"
                viewBox={`0 0 ${bounds.width} ${bounds.height}`}
                preserveAspectRatio="xMidYMid meet"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
                style={{ cursor: 'grab', touchAction: 'none' }}
            >
                <defs>
                    <marker
                        id="auto-arrow"
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto-start-reverse"
                    >
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#8a8f98" />
                    </marker>
                </defs>

                <g transform={transform}>
                    {bands.map((band) => (
                        <g key={band.id}>
                            <rect
                                x={band.x + 6}
                                y={band.y}
                                width={band.w - 12}
                                height={band.h}
                                rx={18}
                                fill={
                                    band.active
                                        ? 'rgba(255,215,0,0.05)'
                                        : 'rgba(255,255,255,0.02)'
                                }
                                stroke={
                                    band.active
                                        ? 'rgba(255,215,0,0.35)'
                                        : 'rgba(255,255,255,0.08)'
                                }
                            />
                            <text
                                x={band.x + 24}
                                fontSize={15}
                                fontWeight={700}
                                fill={band.active ? '#FFD700' : '#9E9E9E'}
                            >
                                {band.titleLines.map((line, i) => (
                                    <tspan
                                        key={i}
                                        x={band.x + 24}
                                        y={
                                            band.y +
                                            band.titleTop +
                                            i * band.titleLineH
                                        }
                                    >
                                        {line}
                                    </tspan>
                                ))}
                            </text>
                        </g>
                    ))}

                    {links.map((link) => (
                        <path
                            key={link.id}
                            d={link.d}
                            fill="none"
                            stroke="#8a8f98"
                            strokeWidth={1.6}
                            strokeDasharray={
                                link.when === 'always' ? undefined : '5 4'
                            }
                            markerEnd="url(#auto-arrow)"
                            opacity={0.75}
                        />
                    ))}

                    {nodes.map((nd) => (
                        <g key={`${nd.automationId}:${nd.id}`}>
                            <rect
                                x={nd.x}
                                y={nd.y}
                                width={nd.w}
                                height={nd.h}
                                rx={12}
                                fill="rgba(20,20,24,0.94)"
                                stroke={nd.color}
                                strokeWidth={1.6}
                            />
                            <rect
                                x={nd.x}
                                y={nd.y}
                                width={5}
                                height={nd.h}
                                rx={2.5}
                                fill={nd.color}
                            />
                            <text
                                x={nd.x + 16}
                                y={nd.y + 20}
                                fontSize={10}
                                fontWeight={700}
                                fill={nd.color}
                                style={{ textTransform: 'uppercase' }}
                            >
                                {t(`automations.kind.${nd.kind}`)}
                            </text>
                            <text
                                x={nd.x + 16}
                                fontSize={nd.fontSize}
                                fill="#E8E8EC"
                            >
                                {nd.lines.map((line, i) => (
                                    <tspan
                                        key={i}
                                        x={nd.x + 16}
                                        y={nd.y + nd.padTop + i * nd.lineH}
                                    >
                                        {line}
                                    </tspan>
                                ))}
                            </text>
                        </g>
                    ))}
                </g>
            </svg>

            <Box
                sx={{
                    position: 'absolute',
                    right: 8,
                    bottom: 8,
                    display: 'flex',
                    gap: 0.5,
                    bgcolor: 'rgba(0,0,0,0.4)',
                    borderRadius: 2,
                }}
            >
                <IconButton
                    size="small"
                    onClick={() =>
                        setView((v) => ({
                            ...v,
                            scale: Math.min(3, v.scale * 1.2),
                        }))
                    }
                >
                    <AddIcon fontSize="small" />
                </IconButton>
                <IconButton
                    size="small"
                    onClick={() =>
                        setView((v) => ({
                            ...v,
                            scale: Math.max(0.3, v.scale / 1.2),
                        }))
                    }
                >
                    <RemoveIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" onClick={reset}>
                    <CenterFocusStrongIcon fontSize="small" />
                </IconButton>
            </Box>

            <Box
                sx={{
                    position: 'absolute',
                    left: 12,
                    bottom: 10,
                    display: 'flex',
                    gap: 1.5,
                    flexWrap: 'wrap',
                }}
            >
                {Object.entries(KIND_COLORS).map(([kind, color]) => (
                    <Box
                        key={kind}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                    >
                        <Box
                            sx={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                bgcolor: color,
                            }}
                        />
                        <Box
                            component="span"
                            sx={{ color: 'grey.400', fontSize: 11 }}
                        >
                            {t(`automations.kind.${kind}`)}
                        </Box>
                    </Box>
                ))}
            </Box>
        </Box>
    );
}
