import React, { useEffect, useState } from 'react';
import {
    Alert,
    Checkbox,
    FormControl,
    InputLabel,
    ListItemText,
    MenuItem,
    Select,
    Typography,
} from '@mui/material';
import { TypePanel, ReadoutRow } from './typeShell';
import { SECTION_LABEL } from './typeStyles';
import { updateProperties } from '../utils';
import { api } from '../../../api/charlie';
import { useTranslation } from 'react-i18next';
import { CameraVision } from '../../CameraVision';

/**
 * Camera control panel: the **modes** the camera runs, the source the feed
 * resolves, and the live view.
 *
 * A mode is a preset (`cameras/modes.ts`): it brings its own classes, dwell,
 * escalation, and whether the camera looks at the shelves or listens for
 * gestures. The selection is a CSV of mode ids kept as a **durable device
 * property** (`Device.properties.visionModes` →
 * `PUT /api/devices/:id/properties`), never in `state` — every gateway read-back
 * `$set`s the whole state bag — and **no mode selected means the camera is not
 * analysed**. The catalogue (labels + hints) comes from the provider schema (the
 * device type's rows, merged by the device layer), so this panel never
 * duplicates the table.
 *
 * The source is provider config: it is read back from the provider row
 * (`GET /api/devices/:id/source`) instead of being copied into the state, so the
 * panel shows what the feed will really open — and, when it will open nothing,
 * why.
 */
export const CameraControls = ({ device, capabilities }) => {
    const { t } = useTranslation();
    const deviceId = device?._id;
    const [properties, setProperties] = useState(device?.properties ?? {});
    const [source, setSource] = useState(null);

    // Re-seed only when the page switches device: the bag is written here, so a
    // parent re-render must never clobber the selection with a stale copy.
    useEffect(() => {
        setProperties(device?.properties ?? {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deviceId]);

    useEffect(() => {
        if (!deviceId) return undefined;
        let cancelled = false;
        api(`devices/${deviceId}/source`)
            .then((data) => {
                if (!cancelled) setSource(data);
            })
            .catch(() => {
                if (!cancelled) setSource(null);
            });
        return () => {
            cancelled = true;
        };
    }, [deviceId]);

    const modes = String(properties.visionModes ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);

    const options =
        capabilities?.state?.find((field) => field.key === 'visionModes')
            ?.options ?? [];
    const optionOf = (id) => options.find((option) => option.value === id);

    const setModes = (ids) =>
        updateProperties(device, { visionModes: ids.join(',') }, setProperties);

    return (
        <TypePanel type="camera" title={t('deviceControls.type.camera')}>
            <CameraVision device={device} />

            <Typography sx={SECTION_LABEL}>
                {t('deviceControls.camera.policy')}
            </Typography>
            <FormControl fullWidth size="small">
                <InputLabel>{t('deviceControls.camera.modes')}</InputLabel>
                <Select
                    multiple
                    value={modes}
                    label={t('deviceControls.camera.modes')}
                    onChange={(event) => setModes(event.target.value)}
                    renderValue={(ids) =>
                        ids
                            .map((id) => optionOf(id)?.label ?? id)
                            .join(', ')
                    }
                >
                    {options.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                            <Checkbox checked={modes.includes(option.value)} />
                            <ListItemText
                                primary={option.label}
                                secondary={option.description}
                            />
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            {/* What the selection actually does — the hints come from the
                provider schema, so they cannot drift from the table. */}
            {modes.length ? (
                modes.map((id) => (
                    <Typography
                        key={id}
                        variant="caption"
                        color="text.secondary"
                        display="block"
                    >
                        {optionOf(id)?.label ?? id}
                        {optionOf(id)?.description
                            ? ` — ${optionOf(id).description}`
                            : ''}
                    </Typography>
                ))
            ) : (
                <Typography variant="caption" color="text.secondary">
                    {t('deviceControls.camera.modesOff')}
                </Typography>
            )}

            <Typography sx={SECTION_LABEL}>
                {t('deviceControls.camera.source')}
            </Typography>
            <ReadoutRow
                label={t('deviceControls.camera.sourceKind')}
                value={source?.source?.kind || '—'}
            />
            <ReadoutRow
                label={t('deviceControls.camera.sourceUrl')}
                value={source?.target || '—'}
            />
            <ReadoutRow
                label={t('deviceControls.camera.snapshotUrl')}
                value={source?.source?.snapshotUrl || '—'}
            />
            {/* What the feed resolves is read back from the provider row, so
                when it resolves to nothing the panel can name the missing
                setting instead of showing three dashes. */}
            {source?.issue ? (
                <Alert severity="warning" sx={{ mt: 1 }}>
                    {t(`deviceControls.camera.sourceIssue.${source.issue}`)}
                </Alert>
            ) : (
                <Typography variant="caption" color="text.secondary">
                    {t('deviceControls.camera.sourceProviderHint')}
                </Typography>
            )}
        </TypePanel>
    );
};

export default CameraControls;
