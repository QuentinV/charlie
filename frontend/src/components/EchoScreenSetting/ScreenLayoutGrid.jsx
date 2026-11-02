import React from 'react';
import {
    Box,
    Chip,
    IconButton,
    Paper,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import LockIcon from '@mui/icons-material/Lock';
import { useTranslation } from 'react-i18next';
import { ScreenCanvas } from './ScreenCanvas';

/**
 * The device seen from the front: one tile per physical panel, in the layout the
 * firmware declares.
 *
 * The tiles are positioned with CSS grid areas named after the panel index
 * (`k0`, `k1`, …) so the arrangement matches the real device — e.g. the weather
 * build's TFT spans two rows and the clock strip spans the full width.
 *
 * @param {object} props
 * @param {object[]} props.panels Panel definitions (`layouts.js`).
 * @param {string} [props.gridTemplateAreas]
 * @param {string} [props.gridTemplateColumns]
 * @param {Record<number, { k: number, texts: object[] }>} props.screensByK
 * @param {{ k: number, index: number|null }|null} props.selection
 * @param {(k: number, index: number|null) => void} props.onSelect
 * @param {(k: number, index: number, cx: number, cy: number) => void} props.onMove
 * @param {(k: number) => void} props.onAddText
 * @param {boolean} props.preview
 * @param {Record<string, string>} props.overrides
 * @param {number} [props.scale]
 */
export const ScreenLayoutGrid = ({
    panels,
    gridTemplateAreas,
    gridTemplateColumns,
    screensByK,
    selection,
    onSelect,
    onMove,
    onAddText,
    preview,
    overrides,
    scale = 2,
}) => {
    const { t } = useTranslation();
    return (
    <Box
        sx={{
            display: 'grid',
            gap: 2,
            alignItems: 'start',
            gridTemplateColumns: gridTemplateColumns ?? '1fr 1fr',
            gridTemplateAreas: gridTemplateAreas || undefined,
        }}
    >
        {panels.map((panel) => {
            const screen = screensByK[panel.k] ?? { k: panel.k, texts: [] };
            const texts = screen.texts ?? [];
            const selectedIndex =
                selection?.k === panel.k ? selection.index : null;
            const reserved = !!panel.reserved;

            return (
                <Paper
                    key={`panel-${panel.k}`}
                    variant="outlined"
                    sx={{
                        p: 1.5,
                        gridArea: gridTemplateAreas ? `k${panel.k}` : undefined,
                        bgcolor: reserved ? 'action.hover' : undefined,
                    }}
                >
                    <Stack spacing={1}>
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                justifyContent: 'space-between',
                            }}
                        >
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                }}
                            >
                                <Typography variant="subtitle2">
                                    {panel.label ??
                                        t('echoScreen.panel', { k: panel.k })}
                                </Typography>
                                <Chip
                                    size="small"
                                    label={`k=${panel.k}`}
                                    variant="outlined"
                                />
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                >
                                    {panel.w}×{panel.h}
                                </Typography>
                            </Box>

                            {reserved ? (
                                <Tooltip
                                    title={
                                        panel.note ??
                                        t('echoScreen.firmwareOwnedPanel')
                                    }
                                >
                                    <LockIcon
                                        fontSize="small"
                                        color="disabled"
                                    />
                                </Tooltip>
                            ) : (
                                <Tooltip title={t('echoScreen.addText')}>
                                    <IconButton
                                        size="small"
                                        onClick={() => onAddText(panel.k)}
                                    >
                                        <AddCircleIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            )}
                        </Box>

                        <ScreenCanvas
                            panel={panel}
                            texts={texts}
                            selectedIndex={selectedIndex}
                            onSelect={(index) => onSelect(panel.k, index)}
                            onMove={(index, cx, cy) =>
                                onMove(panel.k, index, cx, cy)
                            }
                            preview={preview}
                            overrides={overrides}
                            readOnly={reserved}
                            scale={scale}
                        />

                        <Typography variant="caption" color="text.secondary">
                            {reserved
                                ? panel.note ?? t('echoScreen.firmwareOwned')
                                : t('echoScreen.texts', {
                                      count: texts.length,
                                  })}
                        </Typography>
                    </Stack>
                </Paper>
            );
        })}
    </Box>
    );
};

export default ScreenLayoutGrid;
