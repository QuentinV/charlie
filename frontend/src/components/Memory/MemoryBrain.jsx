import React from 'react';
import { Box, IconButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import { buildBrainTree, layoutBrain, truncate } from './layout';

const PREFIX = 'brain';

function usePrefersReducedMotion() {
    const [reduced, setReduced] = React.useState(false);
    React.useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => setReduced(mq.matches);
        update();
        mq.addEventListener?.('change', update);
        return () => mq.removeEventListener?.('change', update);
    }, []);
    return reduced;
}

/**
 * "Living brain" memory diagram: the profile is the core neuron, categories
 * are dendrites and every item a synapse, with impulses travelling the axons.
 * @param {{ profile: any }} props
 */
export default function MemoryBrain({ profile }) {
    const [collapsed, setCollapsed] = React.useState(() => new Set());
    const [view, setView] = React.useState({ scale: 1, tx: 0, ty: 0 });
    const svgRef = React.useRef(null);
    const drag = React.useRef(null);
    const reduced = usePrefersReducedMotion();

    const tree = React.useMemo(() => buildBrainTree(profile), [profile]);
    const { nodes, links, bounds } = React.useMemo(
        () => layoutBrain(tree, { collapsed }),
        [tree, collapsed]
    );

    const cx = bounds.minX + bounds.width / 2;
    const cy = bounds.minY + bounds.height / 2;
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
                    4,
                    Math.max(0.4, v.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12))
                ),
            }));
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, []);

    const onPointerDown = (e) => {
        if (e.button !== 0) return;
        drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e) => {
        if (!drag.current || !svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const dx =
            (e.clientX - drag.current.x) *
            (bounds.width / Math.max(rect.width, 1));
        const dy =
            (e.clientY - drag.current.y) *
            (bounds.height / Math.max(rect.height, 1));
        setView((v) => ({
            ...v,
            tx: drag.current.tx + dx,
            ty: drag.current.ty + dy,
        }));
    };
    const onPointerUp = () => {
        drag.current = null;
    };

    const toggle = (id) =>
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const transform =
        `translate(${view.tx} ${view.ty}) ` +
        `translate(${cx} ${cy}) scale(${view.scale}) translate(${-cx} ${-cy})`;

    return (
        <Box
            sx={{
                position: 'relative',
                width: '100%',
                height: '100%',
                minHeight: 420,
            }}
        >
            <svg
                ref={svgRef}
                viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
                preserveAspectRatio="xMidYMid meet"
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'block',
                    touchAction: 'none',
                    cursor: 'grab',
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
            >
                <defs>
                    <radialGradient id={`${PREFIX}-core`}>
                        <stop offset="0%" stopColor="#FFF3C4" />
                        <stop offset="55%" stopColor="#FFD700" />
                        <stop offset="100%" stopColor="#B8860B" />
                    </radialGradient>
                    <filter
                        id={`${PREFIX}-glow`}
                        x="-60%"
                        y="-60%"
                        width="220%"
                        height="220%"
                    >
                        <feGaussianBlur stdDeviation="5" result="b" />
                        <feMerge>
                            <feMergeNode in="b" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                    <filter
                        id={`${PREFIX}-soft`}
                        x="-80%"
                        y="-80%"
                        width="260%"
                        height="260%"
                    >
                        <feGaussianBlur stdDeviation="3" result="b" />
                        <feMerge>
                            <feMergeNode in="b" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                <g transform={transform}>
                    {links.map((l) => (
                        <path
                            key={l.id}
                            id={l.id}
                            d={l.d}
                            fill="none"
                            stroke={l.color}
                            strokeOpacity={0.3}
                            strokeWidth={1.4}
                        />
                    ))}

                    {!reduced &&
                        links.map((l, i) => (
                            <circle
                                key={`i:${l.id}`}
                                r={2.6}
                                fill={l.color}
                                filter={`url(#${PREFIX}-glow)`}
                            >
                                <animateMotion
                                    dur={`${2.4 + (i % 5) * 0.35}s`}
                                    begin={`${(i % 8) * 0.22}s`}
                                    repeatCount="indefinite"
                                >
                                    <mpath href={`#${l.id}`} />
                                </animateMotion>
                            </circle>
                        ))}

                    {nodes.map((nd) => {
                        const isCategory = nd.kind === 'category';
                        const clickable = isCategory && nd.childCount > 0;
                        return (
                            <g
                                key={nd.id}
                                style={{
                                    cursor: clickable ? 'pointer' : 'default',
                                }}
                                onClick={
                                    clickable ? () => toggle(nd.id) : undefined
                                }
                            >
                                <title>{nd.label}</title>
                                {nd.kind === 'root' && (
                                    <circle
                                        cx={nd.x}
                                        cy={nd.y}
                                        r={nd.r + 14}
                                        fill="#FFD700"
                                        opacity={0.08}
                                    >
                                        {!reduced && (
                                            <animate
                                                attributeName="r"
                                                values={`${nd.r + 10};${
                                                    nd.r + 22
                                                };${nd.r + 10}`}
                                                dur="3.4s"
                                                repeatCount="indefinite"
                                            />
                                        )}
                                    </circle>
                                )}
                                <circle
                                    cx={nd.x}
                                    cy={nd.y}
                                    r={nd.r}
                                    fill={
                                        nd.kind === 'root'
                                            ? `url(#${PREFIX}-core)`
                                            : nd.color
                                    }
                                    fillOpacity={
                                        nd.kind === 'leaf' ? 0.85 : 1
                                    }
                                    stroke={
                                        nd.kind === 'root'
                                            ? '#FFE88C'
                                            : 'rgba(10,10,11,0.6)'
                                    }
                                    strokeWidth={nd.kind === 'root' ? 2 : 1}
                                    filter={`url(#${PREFIX}-${
                                        nd.kind === 'root' ? 'glow' : 'soft'
                                    })`}
                                />
                                {isCategory && (
                                    <text
                                        x={nd.x}
                                        y={nd.y + nd.r + 16}
                                        textAnchor="middle"
                                        fontSize="12"
                                        fontWeight="700"
                                        fill={nd.color}
                                    >
                                        {truncate(nd.label, 18)}
                                        {nd.childCount > 0
                                            ? ` · ${nd.childCount}`
                                            : ''}
                                    </text>
                                )}
                                {nd.kind === 'leaf' && (
                                    <text
                                        x={nd.x + nd.r + 6}
                                        y={nd.y + 3.5}
                                        fontSize="10.5"
                                        fill="rgba(245,245,220,0.72)"
                                    >
                                        {truncate(nd.label, 30)}
                                    </text>
                                )}
                                {nd.kind === 'root' && (
                                    <text
                                        x={nd.x}
                                        y={nd.y + 4}
                                        textAnchor="middle"
                                        fontSize="14"
                                        fontWeight="700"
                                        fill="#0A0A0B"
                                    >
                                        {truncate(nd.label, 14)}
                                    </text>
                                )}
                            </g>
                        );
                    })}
                </g>
            </svg>

            <Box
                sx={{
                    position: 'absolute',
                    right: 8,
                    bottom: 8,
                    display: 'flex',
                    gap: 0.5,
                }}
            >
                <IconButton
                    size="small"
                    onClick={() =>
                        setView((v) => ({
                            ...v,
                            scale: Math.min(4, v.scale * 1.2),
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
                            scale: Math.max(0.4, v.scale / 1.2),
                        }))
                    }
                >
                    <RemoveIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" onClick={reset}>
                    <CenterFocusStrongIcon fontSize="small" />
                </IconButton>
            </Box>
        </Box>
    );
}
