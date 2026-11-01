import React from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    IconButton,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';

/**
 * Local-only replacement values for the placeholders used by the configuration.
 *
 * The values never leave the browser: the server keeps the placeholder, and the
 * real device resolves it against the live state at refresh time. This panel
 * only exists so a layout can be designed without waiting for a real reading.
 *
 * @param {object} props
 * @param {{ raw: string, device: string, path: string }[]} props.placeholders
 * @param {Record<string, string>} props.overrides
 * @param {(raw: string, value: string) => void} props.onChange
 * @param {() => void} props.onReset
 */
export const PreviewPanel = ({ placeholders, overrides, onChange, onReset }) => (
    <Stack spacing={1}>
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
            }}
        >
            <Typography variant="subtitle2">
                Preview values (local only)
            </Typography>
            <Tooltip title="Clear every override">
                <span>
                    <IconButton
                        size="small"
                        onClick={onReset}
                        disabled={!Object.keys(overrides).length}
                    >
                        <RestartAltIcon fontSize="small" />
                    </IconButton>
                </span>
            </Tooltip>
        </Box>

        {!placeholders.length ? (
            <Alert severity="info">
                No <code>{'{{device:Name:path}}'}</code> placeholder in the
                screens yet — add a reading from the text inspector to preview
                one.
            </Alert>
        ) : (
            <Stack spacing={1.5}>
                {placeholders.map((placeholder) => (
                    <Box key={placeholder.raw}>
                        <Chip
                            size="small"
                            variant="outlined"
                            label={placeholder.raw}
                            sx={{ mb: 0.5, fontFamily: 'monospace' }}
                        />
                        <TextField
                            size="small"
                            fullWidth
                            label={`Preview value for ${placeholder.path}`}
                            value={overrides[placeholder.raw] ?? ''}
                            onChange={(event) =>
                                onChange(placeholder.raw, event.target.value)
                            }
                        />
                    </Box>
                ))}
                <Button size="small" onClick={onReset} sx={{ alignSelf: 'flex-start' }}>
                    Clear all
                </Button>
            </Stack>
        )}
    </Stack>
);

export default PreviewPanel;
