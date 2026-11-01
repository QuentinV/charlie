import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Divider,
    FormControlLabel,
    Paper,
    Snackbar,
    Stack,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import { api } from '../../api/charlie';
import { ScreenLayoutGrid } from './ScreenLayoutGrid';
import { TextInspector } from './TextInspector';
import { PreviewPanel } from './PreviewPanel';
import {
    isReservedPanel,
    orderScreensByLayout,
    resolveLayout,
} from './layouts';
import { DEFAULT_TEXT, collectPlaceholders } from './screenUtils';

/**
 * Visual configuration of the echo displays.
 *
 * The editor draws every physical panel of the device (see `layouts.js`) and
 * lets the user drag a text onto it, exactly where the firmware will print it:
 * the canvas positions are `cx`/`cy` and the stored configuration is unchanged —
 * the same `{ k, texts }` tree the server feeds to `updateDisplays`.
 *
 * Two firmware constraints are enforced here:
 * - a reserved panel (the clock strip, `k = 0`) is painted by the firmware, so
 *   it is read-only in the UI and stripped from the saved payload;
 * - placement is per panel, because `setRotation()` swaps the coordinate axes of
 *   odd quadrants — the inspector adjusts its bounds accordingly.
 *
 * @param {object} props
 * @param {string} props.id Echo settings id.
 * @param {string} [props.deviceType] Firmware type, selects the layout.
 */
export const EchoScreenSetting = ({ id, deviceType }) => {
    const [refreshTime, setRefreshTime] = useState(30);
    /** `k -> { k, texts }`, the exact shape stored in `echo_settings`. */
    const [screensByK, setScreensByK] = useState({});
    const [selection, setSelection] = useState(null);
    const [devices, setDevices] = useState([]);
    const [preview, setPreview] = useState(false);
    const [overrides, setOverrides] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState(null);

    useEffect(() => {
        if (!id) return;
        setLoading(true);
        api(`echo/${id}/screens`)
            .then((res) => {
                setRefreshTime(res?.refreshTime ?? 30);
                const byKey = {};
                for (const screen of res?.screens ?? []) {
                    const k = Number(screen.k ?? 0);
                    byKey[k] = { k, texts: screen.texts ?? [] };
                }
                setScreensByK(byKey);
                // A selection or an override belongs to one device: never carry
                // it over when the editor switches device.
                setSelection(null);
                setOverrides({});
            })
            .finally(() => setLoading(false));
    }, [id]);

    // Device names feed the metric picker; the paths come from each device's own
    // capability schema, so no brand vocabulary is hard-coded here.
    useEffect(() => {
        api('devices')
            .then((res) => setDevices(res ?? []))
            .catch(() => setDevices([]));
    }, []);

    // `screensByK` is keyed by the numeric `k`, so a plain `Object.values()`
    // would hand back ascending `k` order. That is *not* the display order:
    // the order declared in `DEVICE_LAYOUTS.panels` is (the dashboard lists
    // `k = 4, 3, 2, 1`, so its Panel 1 is `k = 4`). The layout is resolved from
    // the raw screens first, then the ordered array is derived from it.
    const rawScreens = useMemo(() => Object.values(screensByK), [screensByK]);
    const layout = useMemo(
        () => resolveLayout(deviceType, rawScreens),
        [deviceType, rawScreens]
    );
    const screens = useMemo(
        () => orderScreensByLayout(layout.panels, rawScreens),
        [layout, rawScreens]
    );

    const panelByK = useMemo(() => {
        const map = {};
        for (const panel of layout.panels) map[panel.k] = panel;
        return map;
    }, [layout]);

    /**
     * Screens no panel describes: kept visible and editable, never dropped.
     * `screens` is already ordered (declared panels first, in layout order, then
     * undeclared ones), so filtering preserves that order.
     */
    const extraPanels = useMemo(
        () =>
            screens
                .filter((screen) => !panelByK[screen.k] && screen.k !== 0)
                .map((screen) => ({
                    k: screen.k,
                    w: 128,
                    h: 64,
                    kind: 'oled',
                    label: `Panel ${screen.k}`,
                })),
        [screens, panelByK]
    );

    // Reserved screens are stripped on save, so their texts are not previewed.
    const placeholders = useMemo(
        () =>
            collectPlaceholders(
                screens.filter(
                    (screen) => !isReservedPanel(panelByK[screen.k])
                )
            ),
        [screens, panelByK]
    );

    const updateText = useCallback((k, index, patch) => {
        setScreensByK((prev) => {
            const screen = prev[k] ?? { k, texts: [] };
            const texts = [...(screen.texts ?? [])];
            texts[index] = { ...texts[index], ...patch };
            return { ...prev, [k]: { ...screen, texts } };
        });
    }, []);

    const addText = useCallback(
        (k) => {
            const index = (screensByK[k]?.texts ?? []).length;
            setScreensByK((prev) => {
                const screen = prev[k] ?? { k, texts: [] };
                return {
                    ...prev,
                    [k]: {
                        ...screen,
                        texts: [...(screen.texts ?? []), { ...DEFAULT_TEXT }],
                    },
                };
            });
            setSelection({ k, index });
        },
        [screensByK]
    );

    const removeText = useCallback((k, index) => {
        setScreensByK((prev) => {
            const screen = prev[k] ?? { k, texts: [] };
            return {
                ...prev,
                [k]: {
                    ...screen,
                    texts: (screen.texts ?? []).filter((_, i) => i !== index),
                },
            };
        });
        setSelection((current) => {
            if (!current || current.k !== k) return current;
            if (current.index === index) return null;
            return current.index > index
                ? { k, index: current.index - 1 }
                : current;
        });
    }, []);

    const handleSave = () => {
        if (!id) return;
        setSaving(true);

        // Reserved panels (the clock strip) must never be sent: a refresh would
        // paint over the firmware clock. `screens` is already ordered by the
        // panel list of the layout (never by `k`), so filtering keeps that order
        // and the saved array reads in the same order as the device's panels.
        const editable = screens
            .filter((screen) => !isReservedPanel(panelByK[screen.k]))
            .map((screen) => ({ k: screen.k, texts: screen.texts ?? [] }));

        api(`echo/${id}/screens`, {
            method: 'POST',
            body: JSON.stringify({ refreshTime, screens: editable }),
        })
            .then(() =>
                setToast({
                    severity: 'success',
                    message: 'Screen configuration saved',
                })
            )
            .catch((error) =>
                setToast({
                    severity: 'error',
                    message: `Save failed: ${error?.message ?? error}`,
                })
            )
            .finally(() => setSaving(false));
    };

    const selectedText = selection
        ? screensByK[selection.k]?.texts?.[selection.index] ?? null
        : null;
    const selectedPanel = selection
        ? panelByK[selection.k] ??
          extraPanels.find((panel) => panel.k === selection.k) ??
          null
        : null;

    return (
        <Box component="section" sx={{ mt: 3 }}>
            <Typography variant="h6">Screen display configuration</Typography>
            <Typography variant="body2" color="text.secondary">
                {layout.description} Drag a text on a panel to move it, click one
                to edit its size, position and rotation.
            </Typography>

            <Box
                sx={{
                    display: 'grid',
                    gap: 2,
                    mt: 2,
                    alignItems: 'start',
                    gridTemplateColumns: {
                        xs: '1fr',
                        lg: 'minmax(0, 2fr) minmax(340px, 1fr)',
                    },
                }}
            >
                <Stack spacing={2}>
                    <Paper elevation={1} sx={{ p: 2 }}>
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 1,
                                flexWrap: 'wrap',
                            }}
                        >
                            <Typography variant="subtitle1">
                                {layout.title} — {layout.panels.length} panel
                                {layout.panels.length === 1 ? '' : 's'}
                            </Typography>
                            <FormControlLabel
                                control={
                                    <Switch
                                        size="small"
                                        checked={preview}
                                        onChange={(event) =>
                                            setPreview(event.target.checked)
                                        }
                                    />
                                }
                                label="Preview"
                            />
                        </Box>

                        {!layout.known && (
                            <Alert severity="warning" sx={{ mt: 1 }}>
                                This firmware type is not described in
                                <code> layouts.js</code>, so panels are shown as
                                generic 128×64 screens. Positions are still
                                saved as-is.
                            </Alert>
                        )}

                        <Divider sx={{ my: 1.5 }} />

                        <ScreenLayoutGrid
                            panels={layout.panels}
                            gridTemplateAreas={layout.gridTemplateAreas}
                            gridTemplateColumns={layout.gridTemplateColumns}
                            screensByK={screensByK}
                            selection={selection}
                            onSelect={(k, index) =>
                                setSelection(
                                    index === null ? null : { k, index }
                                )
                            }
                            onMove={(k, index, cx, cy) =>
                                updateText(k, index, { cx, cy })
                            }
                            onAddText={addText}
                            preview={preview}
                            overrides={overrides}
                        />

                        {extraPanels.length > 0 && (
                            <>
                                <Typography
                                    variant="subtitle2"
                                    sx={{ mt: 2, mb: 1 }}
                                >
                                    Additional configured panels
                                </Typography>
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ display: 'block', mb: 1 }}
                                >
                                    Indices this firmware does not declare: the
                                    device ignores them until a build with more
                                    panels is flashed.
                                </Typography>
                                <ScreenLayoutGrid
                                    panels={extraPanels}
                                    screensByK={screensByK}
                                    selection={selection}
                                    onSelect={(k, index) =>
                                        setSelection(
                                            index === null ? null : { k, index }
                                        )
                                    }
                                    onMove={(k, index, cx, cy) =>
                                        updateText(k, index, { cx, cy })
                                    }
                                    onAddText={addText}
                                    preview={preview}
                                    overrides={overrides}
                                />
                            </>
                        )}
                    </Paper>

                    <Paper elevation={1} sx={{ p: 2 }}>
                        <Stack
                            direction="row"
                            spacing={2}
                            alignItems="center"
                            sx={{ flexWrap: 'wrap' }}
                        >
                            <RefreshIcon color="action" />
                            <TextField
                                label="Refresh time (seconds)"
                                type="number"
                                size="small"
                                value={refreshTime}
                                onChange={(event) =>
                                    setRefreshTime(Number(event.target.value))
                                }
                                inputProps={{ min: 1, max: 3600 }}
                                helperText="How often the server refreshes the screens"
                                sx={{ minWidth: 220 }}
                            />
                            <Button
                                variant="contained"
                                startIcon={<SaveIcon />}
                                onClick={handleSave}
                                disabled={saving || loading}
                            >
                                {saving ? 'Saving…' : 'Save screen configuration'}
                            </Button>
                        </Stack>
                    </Paper>
                </Stack>

                <Stack spacing={2}>
                    {selectedText && selectedPanel ? (
                        <TextInspector
                            text={selectedText}
                            panel={selectedPanel}
                            devices={devices}
                            onChange={(patch) =>
                                updateText(selection.k, selection.index, patch)
                            }
                            onRemove={() =>
                                removeText(selection.k, selection.index)
                            }
                            preview={preview}
                            overrides={overrides}
                        />
                    ) : (
                        <Alert severity="info">
                            Select a text on a panel to edit it, or press the +
                            button on a panel to add one.
                        </Alert>
                    )}

                    {preview && (
                        <Paper elevation={1} sx={{ p: 2 }}>
                            <PreviewPanel
                                placeholders={placeholders}
                                overrides={overrides}
                                onChange={(raw, value) =>
                                    setOverrides((prev) => ({
                                        ...prev,
                                        [raw]: value,
                                    }))
                                }
                                onReset={() => setOverrides({})}
                            />
                        </Paper>
                    )}

                    <Alert severity="info">
                        The clock strip (k=0) is painted by the firmware: it is
                        read-only here and never sent in the saved configuration.
                    </Alert>
                </Stack>
            </Box>

            <Snackbar
                open={!!toast}
                autoHideDuration={4000}
                onClose={() => setToast(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    severity={toast?.severity ?? 'info'}
                    onClose={() => setToast(null)}
                >
                    {toast?.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default EchoScreenSetting;


