import React from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import { useTranslation } from 'react-i18next';
import { CYCLE_COLOR, KIND_COLORS, NODE_METRICS, fitView, layoutHouseGraph } from './layout';

const slug = (color) => String(color).replace(/[^a-z0-9]/gi, '');

/** The canvas is a fixed-size viewport: pan/zoom shows the rest of the picture. */
const CANVAS_HEIGHT = 'clamp(420px, 62vh, 680px)';

/**
 * Read-only house graph.
 *
 * One SVG picture of cause and effect: shared **state** definitions, the steps
 * each automation declares, and the arcs an action was *observed* producing
 * (dashed). A red arc is a cycle — the feedback the engine's cascade depth and
 * cooldowns exist to contain. Editing is out of scope; the accordion above owns
 * the controls.
 */
export default function AutomationGraph({ graph }) {
    const { t } = useTranslation();

    /**
     * A definition has no owner, so its second line lists the transitions seen
     * through it and how it is used; a step node shows the automation it belongs
     * to. Composed here (not in the geometry) so the `i18n` stays in the
     * component while the layout still measures exactly what will be drawn.
     */
    const subtitleOf = React.useCallback(
        (nd) => {
            const parts = [];
            if (nd.values?.length) parts.push(nd.values.join(' · '));
            if (nd.watches > 1) {
                parts.push(t('automations.nodeWatches', { n: nd.watches }));
            }
            if (nd.effects) {
                parts.push(t('automations.nodeEffects', { n: nd.effects }));
            }
            return [nd.automationName, ...parts].filter(Boolean).join(' · ');
        },
        [t]
    );

    const { nodes, edges, bounds } = React.useMemo(
        () =>
            layoutHouseGraph(
                (graph?.nodes ?? []).map((nd) => ({
                    ...nd,
                    subtitle: subtitleOf(nd),
                })),
                graph?.edges ?? []
            ),
        [graph, subtitleOf]
    );

    const [view, setView] = React.useState({ scale: 1, tx: 0, ty: 0 });
    const svgRef = React.useRef(null);
    const boxRef = React.useRef(null);
    const drag = React.useRef(null);

    const cx = bounds.width / 2;
    const cy = bounds.height / 2;

    /**
     * The canvas has a fixed size, so the graph is fitted into it rather than the
     * other way round (the maths lives in `layout.js#fitView`).
     */
    const fit = React.useCallback(() => {
        const box = boxRef.current;
        setView(
            fitView(bounds, {
                width: box?.clientWidth ?? 0,
                height: box?.clientHeight ?? 0,
            })
        );
    }, [bounds]);

    // Fit on first paint, whenever the graph changes, and when the box resizes.
    React.useEffect(() => {
        fit();
        const box = boxRef.current;
        if (!box || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(() => fit());
        observer.observe(box);
        return () => observer.disconnect();
    }, [fit]);

    const reset = fit;

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
    }, [nodes.length]);

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

    if (!nodes.length) {
        return (
            <Box
                sx={{
                    height: CANVAS_HEIGHT,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    p: 4,
                    textAlign: 'center',
                    borderRadius: 3,
                    border: '1px solid',
                    borderColor: 'grey.900',
                }}
            >
                <Typography sx={{ color: 'text.secondary' }}>
                    {t('automations.emptyGraph')}
                </Typography>
            </Box>
        );
    }

    const transform =
        `translate(${view.tx} ${view.ty}) ` +
        `translate(${cx} ${cy}) scale(${view.scale}) translate(${-cx} ${-cy})`;
    const arrowColors = [...new Set(edges.map((edge) => edge.color))];


    return (
        <Box
            ref={boxRef}
            sx={{
                position: 'relative',
                width: '100%',
                // A real viewport, not a canvas that grows with the picture: the
                // size never changes, pan/zoom shows the rest (fitted on load).
                height: CANVAS_HEIGHT,
                overflow: 'hidden',
                borderRadius: 3,
                bgcolor: 'rgba(255,255,255,0.02)',
                border: '1px solid',
                borderColor: 'grey.900',
            }}
        >
            <svg
                ref={svgRef}
                width="100%"
                height="100%"
                style={{
                    cursor: 'grab',
                    touchAction: 'none',
                    display: 'block',
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
            >
                <defs>
                    {arrowColors.map((color) => (
                        <marker
                            key={color}
                            id={`arrow-${slug(color)}`}
                            viewBox="0 0 10 10"
                            refX="9"
                            refY="5"
                            markerWidth="6"
                            markerHeight="6"
                            orient="auto-start-reverse"
                        >
                            <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
                        </marker>
                    ))}
                </defs>

                <g transform={transform}>
                    {edges.map((edge) => (
                        <g key={edge.id}>
                            <title>
                                {edge.cycle
                                    ? t('automations.cycle')
                                    : edge.kind === 'effect'
                                    ? t('automations.observed', {
                                          n: edge.count ?? 1,
                                      })
                                    : ''}
                            </title>
                            <path
                                d={edge.d}
                                fill="none"
                                stroke={edge.color}
                                strokeWidth={edge.dashed ? 1.4 : 1.9}
                                strokeDasharray={
                                    edge.dashed ? '6 4' : undefined
                                }
                                markerEnd={`url(#arrow-${slug(edge.color)})`}
                            />
                            {/* The transition itself: `on`, `off`, `≠ on`, `~`. */}
                            {!!edge.label && (
                                <text
                                    x={edge.labelX}
                                    y={edge.labelY}
                                    fontSize={10}
                                    fill={edge.color}
                                    textAnchor="middle"
                                    style={{
                                        paintOrder: 'stroke',
                                        stroke: 'rgba(12,12,16,0.95)',
                                        strokeWidth: 4,
                                    }}
                                >
                                    {edge.label}
                                </text>
                            )}
                        </g>
                    ))}

                    {nodes.map((nd) => (
                        <g key={nd.id}>
                            <title>{nd.label}</title>
                            <rect
                                x={nd.x}
                                y={nd.y}
                                width={nd.w}
                                height={nd.h}
                                rx={NODE_METRICS.radius}
                                fill="rgba(18,18,22,0.96)"
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
                                y={nd.y + NODE_METRICS.captionY}
                                fontSize={10}
                                fontWeight={700}
                                fill={nd.color}
                                style={{ textTransform: 'uppercase' }}
                            >
                                {t(`automations.kind.${nd.kind}`)}
                            </text>
                            <text
                                x={nd.x + 16}
                                fontSize={NODE_METRICS.labelFont}
                                fill="#E8E8EC"
                            >
                                {nd.lines.map((line, i) => (
                                    <tspan
                                        key={i}
                                        x={nd.x + 16}
                                        y={
                                            nd.y +
                                            NODE_METRICS.padTop +
                                            i * NODE_METRICS.lineH
                                        }
                                    >
                                        {line}
                                    </tspan>
                                ))}
                            </text>
                            {!!nd.subtitle && (
                                <text
                                    x={nd.x + 16}
                                    y={
                                        nd.y +
                                        NODE_METRICS.padTop +
                                        (nd.lines.length - 1) *
                                            NODE_METRICS.lineH +
                                        NODE_METRICS.subtitleGap
                                    }
                                    fontSize={NODE_METRICS.subtitleFont}
                                    fill="#8A8A93"
                                >
                                    {nd.subtitle}
                                </text>
                            )}
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
                    right: 124,
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

                {/* What the arcs mean: without this, a dotted line reads as a bug. */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box
                        sx={{
                            width: 18,
                            borderTop: '2px solid',
                            borderColor: 'grey.400',
                        }}
                    />
                    <Box
                        component="span"
                        sx={{ color: 'grey.400', fontSize: 11 }}
                    >
                        {t('automations.legendDeclared')}
                    </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box
                        sx={{
                            width: 18,
                            borderTop: '2px dashed',
                            borderColor: 'grey.400',
                        }}
                    />
                    <Box
                        component="span"
                        sx={{ color: 'grey.400', fontSize: 11 }}
                    >
                        {t('automations.legendObserved')}
                    </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box
                        sx={{
                            width: 18,
                            borderTop: '2px solid',
                            borderColor: CYCLE_COLOR,
                        }}
                    />
                    <Box
                        component="span"
                        sx={{ color: 'grey.400', fontSize: 11 }}
                    >
                        {t('automations.legendLoop')}
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}

