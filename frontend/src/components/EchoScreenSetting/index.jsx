import React, { useEffect, useState } from 'react';
import {
    Box,
    TextField,
    Button,
    Typography,
    Paper,
    Stack,
    IconButton,
    Divider,
    Tooltip,
} from '@mui/material';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import RemoveCircleIcon from '@mui/icons-material/RemoveCircle';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import { api } from '../../api/charlie';

const defaultText = {
    ts: 1,
    v: '',
    cx: 0,
    cy: 0,
    r: 0,
};

const defaultScreen = {
    k: 0,
    texts: [],
};

export const EchoScreenSetting = ({ ip }) => {
    const [screens, setScreens] = useState(null);
    const [refreshTime, setRefreshTime] = useState(30);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!ip) return;
        setLoading(true);
        api(`echo/${ip.replaceAll('.', '-')}/screens`)
            .then((res) => {
                setRefreshTime(res.refreshTime ?? 30);
                setScreens(res.screens ?? []);
            })
            .finally(() => setLoading(false));
    }, [ip]);

    const handleScreenChange = (screenIndex, field, value) => {
        setScreens((prev) => {
            const updated = [...(prev || [])];
            updated[screenIndex] = {
                ...updated[screenIndex],
                [field]: value,
            };
            return updated;
        });
    };

    const handleTextChange = (screenIndex, textIndex, field, value) => {
        setScreens((prev) => {
            const updated = [...(prev || [])];
            const texts = [...(updated[screenIndex]?.texts || [])];
            texts[textIndex] = {
                ...texts[textIndex],
                [field]: value,
            };
            updated[screenIndex] = {
                ...updated[screenIndex],
                texts,
            };
            return updated;
        });
    };

    const addScreen = () => {
        setScreens((prev) => {
            const current = prev || [];
            const maxK = current.reduce(
                (max, s) => Math.max(max, s.k ?? 0),
                -1
            );
            return [...current, { ...defaultScreen, k: maxK + 1, texts: [] }];
        });
    };

    const removeScreen = (screenIndex) => {
        setScreens((prev) => (prev || []).filter((_, i) => i !== screenIndex));
    };

    const addText = (screenIndex) => {
        setScreens((prev) => {
            const updated = [...(prev || [])];
            const texts = [...(updated[screenIndex]?.texts || [])];
            texts.push({ ...defaultText });
            updated[screenIndex] = {
                ...updated[screenIndex],
                texts,
            };
            return updated;
        });
    };

    const removeText = (screenIndex, textIndex) => {
        setScreens((prev) => {
            const updated = [...(prev || [])];
            const texts = (updated[screenIndex]?.texts || []).filter(
                (_, i) => i !== textIndex
            );
            updated[screenIndex] = {
                ...updated[screenIndex],
                texts,
            };
            return updated;
        });
    };

    const handleSave = () => {
        setLoading(true);
        api(`echo/${ip.replaceAll('.', '-')}/screens`, {
            method: 'POST',
            body: JSON.stringify({ screens, refreshTime }),
        }).finally(() => setLoading(false));
    };

    if (!screens) {
        return null;
    }

    return (
        <Paper elevation={1} sx={{ p: 2 }}>
            <Box
                sx={{
                    gap: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    width: '100%',
                }}
            >
                <Typography variant="h6" sx={{ mt: 2 }}>
                    Screen Display Configuration
                </Typography>

                <Paper elevation={3} sx={{ p: 3 }}>
                    <Stack spacing={2}>
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                            }}
                        >
                            <RefreshIcon color="action" />
                            <Typography variant="subtitle1">
                                Refresh Settings
                            </Typography>
                        </Box>
                        <TextField
                            label="Refresh Time (seconds)"
                            type="number"
                            value={refreshTime}
                            onChange={(e) =>
                                setRefreshTime(Number(e.target.value))
                            }
                            fullWidth
                            variant="outlined"
                            inputProps={{ min: 1, max: 3600 }}
                            helperText="How often the screens should cycle (in seconds)"
                        />
                    </Stack>
                </Paper>

                {screens.map((screen, screenIndex) => (
                    <Paper
                        elevation={3}
                        sx={{ p: 3 }}
                        key={`screen-${screenIndex}`}
                    >
                        <Stack spacing={2}>
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                }}
                            >
                                <Typography variant="subtitle1">
                                    Screen #{screenIndex + 1}
                                </Typography>
                                <Tooltip title="Remove this screen">
                                    <IconButton
                                        color="error"
                                        onClick={() =>
                                            removeScreen(screenIndex)
                                        }
                                        size="small"
                                    >
                                        <DeleteIcon />
                                    </IconButton>
                                </Tooltip>
                            </Box>

                            <Divider />

                            <TextField
                                label="Screen Key (k)"
                                type="number"
                                value={screen.k ?? 0}
                                onChange={(e) =>
                                    handleScreenChange(
                                        screenIndex,
                                        'k',
                                        Number(e.target.value)
                                    )
                                }
                                fullWidth
                                variant="outlined"
                                helperText="Unique identifier for this screen"
                            />

                            <Typography variant="subtitle2" sx={{ mt: 1 }}>
                                Text Items
                            </Typography>

                            {(screen.texts || []).map((text, textIndex) => (
                                <Paper
                                    elevation={1}
                                    sx={{ p: 2, bgcolor: 'background.default' }}
                                    key={`screen-${screenIndex}-text-${textIndex}`}
                                >
                                    <Stack spacing={2}>
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                            }}
                                        >
                                            <Typography
                                                variant="caption"
                                                color="text.secondary"
                                            >
                                                Text #{textIndex + 1}
                                            </Typography>
                                            <Tooltip title="Remove this text item">
                                                <IconButton
                                                    color="error"
                                                    onClick={() =>
                                                        removeText(
                                                            screenIndex,
                                                            textIndex
                                                        )
                                                    }
                                                    size="small"
                                                >
                                                    <RemoveCircleIcon />
                                                </IconButton>
                                            </Tooltip>
                                        </Box>

                                        <TextField
                                            label="Text Content (v)"
                                            value={text.v ?? ''}
                                            onChange={(e) =>
                                                handleTextChange(
                                                    screenIndex,
                                                    textIndex,
                                                    'v',
                                                    e.target.value
                                                )
                                            }
                                            fullWidth
                                            variant="outlined"
                                            multiline
                                            rows={2}
                                            placeholder="Enter text to display..."
                                        />

                                        <Box
                                            sx={{
                                                display: 'grid',
                                                gridTemplateColumns: '1fr 1fr',
                                                gap: 2,
                                            }}
                                        >
                                            <TextField
                                                label="Text Size (ts)"
                                                type="number"
                                                value={text.ts ?? 1}
                                                onChange={(e) =>
                                                    handleTextChange(
                                                        screenIndex,
                                                        textIndex,
                                                        'ts',
                                                        Number(e.target.value)
                                                    )
                                                }
                                                variant="outlined"
                                                inputProps={{
                                                    min: 0,
                                                    step: 0.5,
                                                }}
                                            />
                                            <TextField
                                                label="Rotation (r) °"
                                                type="number"
                                                value={text.r ?? 0}
                                                onChange={(e) =>
                                                    handleTextChange(
                                                        screenIndex,
                                                        textIndex,
                                                        'r',
                                                        Number(e.target.value)
                                                    )
                                                }
                                                variant="outlined"
                                                inputProps={{
                                                    min: 0,
                                                    max: 360,
                                                }}
                                            />
                                            <TextField
                                                label="Cursor X (cx)"
                                                type="number"
                                                value={text.cx ?? 0}
                                                onChange={(e) =>
                                                    handleTextChange(
                                                        screenIndex,
                                                        textIndex,
                                                        'cx',
                                                        Number(e.target.value)
                                                    )
                                                }
                                                variant="outlined"
                                            />
                                            <TextField
                                                label="Cursor Y (cy)"
                                                type="number"
                                                value={text.cy ?? 0}
                                                onChange={(e) =>
                                                    handleTextChange(
                                                        screenIndex,
                                                        textIndex,
                                                        'cy',
                                                        Number(e.target.value)
                                                    )
                                                }
                                                variant="outlined"
                                            />
                                        </Box>
                                    </Stack>
                                </Paper>
                            ))}

                            <Button
                                variant="outlined"
                                startIcon={<AddCircleIcon />}
                                onClick={() => addText(screenIndex)}
                                size="small"
                            >
                                Add Text Item
                            </Button>
                        </Stack>
                    </Paper>
                ))}

                <Button
                    variant="outlined"
                    startIcon={<AddCircleIcon />}
                    onClick={addScreen}
                    sx={{ alignSelf: 'flex-start' }}
                >
                    Add Screen
                </Button>

                <Button
                    variant="contained"
                    size="large"
                    startIcon={<SaveIcon />}
                    onClick={handleSave}
                    disabled={loading}
                    sx={{ mt: 1 }}
                >
                    {loading ? 'Saving...' : 'Save screen configuration'}
                </Button>
            </Box>
        </Paper>
    );
};
