import React from 'react';
import {
    Box,
    Divider,
    IconButton,
    Paper,
    Stack,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { MetricPicker } from './MetricPicker';
import { substitutePlaceholders } from './screenUtils';
import { normalizeRotation } from './screenTransforms';

const ROTATIONS = [
    { value: 0, label: '0°' },
    { value: 1, label: '90°' },
    { value: 2, label: '180°' },
    { value: 3, label: '270°' },
];

/**
 * Property editor for one text item of a screen.
 *
 * Every field maps 1:1 to what the firmware reads in `_updateDisplay()`, so the
 * stored configuration needs no translation: `v` (text, placeholders allowed),
 * `ts` (Adafruit text size, 1 = 6×8 px cell), `cx`/`cy` (cursor in the panel's
 * rotated coordinate space) and `r` (rotation quadrant 0–3).
 *
 * @param {object} props
 * @param {{ ts?: number, v?: string, cx?: number, cy?: number, r?: number }} props.text
 * @param {{ k: number, w: number, h: number, label?: string }} props.panel
 * @param {{ _id: string, name?: string }[]} props.devices
 * @param {(patch: object) => void} props.onChange
 * @param {() => void} props.onRemove
 * @param {boolean} [props.preview]
 * @param {Record<string, string>} [props.overrides]
 */
export const TextInspector = ({
    text,
    panel,
    devices,
    onChange,
    onRemove,
    preview = false,
    overrides = {},
}) => {
    const rotation = normalizeRotation(text.r);
    // Odd quadrants swap the panel's axes: the cursor then lives in a
    // height × width space, exactly like Adafruit's `setRotation()`.
    const maxX = rotation % 2 === 1 ? panel.h : panel.w;
    const maxY = rotation % 2 === 1 ? panel.w : panel.h;

    return (
        <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={2}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <Typography variant="subtitle2">
                        {panel.label ?? `Panel ${panel.k}`} — {panel.w}×
                        {panel.h}
                    </Typography>
                    <Tooltip title="Delete this text">
                        <IconButton size="small" color="error" onClick={onRemove}>
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>

                <TextField
                    label="Text"
                    value={text.v ?? ''}
                    onChange={(event) => onChange({ v: event.target.value })}
                    multiline
                    minRows={1}
                    fullWidth
                    helperText="Plain text, or a {{device:Name:path}} placeholder resolved by the server"
                />

                {preview && (
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                    >
                        → {substitutePlaceholders(text.v, overrides) || '(empty)'}
                    </Typography>
                )}

                <Divider />

                <MetricPicker
                    devices={devices}
                    onInsert={(placeholder) =>
                        onChange({ v: `${text.v ?? ''}${placeholder}` })
                    }
                />

                <Divider />

                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <TextField
                        size="small"
                        label="Text size (ts)"
                        type="number"
                        value={text.ts ?? 1}
                        onChange={(event) =>
                            onChange({ ts: Number(event.target.value) })
                        }
                        inputProps={{ min: 1, max: 8 }}
                        helperText={`${6 * (text.ts ?? 1)}×${
                            8 * (text.ts ?? 1)
                        } px cell`}
                        sx={{ flex: 1, minWidth: 110 }}
                    />
                    <TextField
                        size="small"
                        label="Cursor X (cx)"
                        type="number"
                        value={text.cx ?? 0}
                        onChange={(event) =>
                            onChange({ cx: Number(event.target.value) })
                        }
                        inputProps={{ min: 0, max: maxX }}
                        helperText={`0–${maxX}`}
                        sx={{ flex: 1, minWidth: 110 }}
                    />
                    <TextField
                        size="small"
                        label="Cursor Y (cy)"
                        type="number"
                        value={text.cy ?? 0}
                        onChange={(event) =>
                            onChange({ cy: Number(event.target.value) })
                        }
                        inputProps={{ min: 0, max: maxY }}
                        helperText={`0–${maxY}`}
                        sx={{ flex: 1, minWidth: 110 }}
                    />
                </Box>

                <Box>
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', mb: 0.5 }}
                    >
                        Rotation (r) — quadrant applied to this text
                    </Typography>
                    <ToggleButtonGroup
                        exclusive
                        size="small"
                        value={rotation}
                        onChange={(_event, value) =>
                            value !== null && onChange({ r: value })
                        }
                    >
                        {ROTATIONS.map((option) => (
                            <ToggleButton key={option.value} value={option.value}>
                                {option.label}
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                </Box>
            </Stack>
        </Paper>
    );
};

export default TextInspector;
