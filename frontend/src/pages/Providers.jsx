import React, { useEffect, useState } from 'react';
import {
    Box,
    Card,
    CardContent,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Button,
    IconButton,
    TextField,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Chip,
    Typography,
    Grid,
    Snackbar,
    Alert,
} from '@mui/material';
import { api } from '../api/charlie';
import { IntegrationManager } from '../components/IntegrationManager';
import { useTranslation } from 'react-i18next';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SettingsIcon from '@mui/icons-material/Settings';

const PROVIDER_TYPES = [
    { value: 'gateway', labelKey: 'providers.type.gateway' },
    { value: 'direct', labelKey: 'providers.type.direct' },
    { value: 'cloud', labelKey: 'providers.type.cloud' },
];

export const ProvidersPage = () => {
    const { t } = useTranslation();
    const [providers, setProviders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingProvider, setEditingProvider] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        type: 'gateway',
        host: '',
        user: '',
        password: '',
        codesource: '',
        multidevices: false,
    });
    const [snackbar, setSnackbar] = useState({
        open: false,
        message: '',
        severity: 'success',
    });
    const [codesources, setCodesources] = useState([]);
    const [haOpen, setHaOpen] = useState(false);

    const fetchProviders = async () => {
        try {
            const data = await api('providers');
            setProviders(data || []);
        } catch (e) {
            console.error(e);
            showSnackbar(t('providers.loadFailed'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const showSnackbar = (message, severity) => {
        setSnackbar({ open: true, message, severity });
    };

    const handleCloseSnackbar = () => {
        setSnackbar({ ...snackbar, open: false });
    };

    useEffect(() => {
        fetchProviders();
    }, []);

    const fetchCodesources = async () => {
        try {
            const data = await api('providers/codesources');
            setCodesources(data || []);
        } catch (e) {
            console.error(e);
        }
    };

    const handleOpenDialog = async (provider = null) => {
        await fetchCodesources();

        if (provider) {
            setEditingProvider(provider);
            setFormData({
                name: provider.name || '',
                type: provider.type || 'gateway',
                host: provider.host || '',
                user: provider.user || '',
                password: provider.password || '',
                codesource: provider.codesource || '',
                multidevices: provider.multidevices || false,
            });
        } else {
            setEditingProvider(null);
            setFormData({
                name: '',
                type: 'gateway',
                host: '',
                user: '',
                password: '',
                codesource: '',
                multidevices: false,
            });
        }
        setDialogOpen(true);
    };

    const handleCloseDialog = () => {
        setDialogOpen(false);
        setEditingProvider(null);
    };

    const handleSubmit = async () => {
        try {
            await api('providers', {
                method: 'POST',
                body: JSON.stringify({
                    _id: editingProvider?._id ?? undefined,
                    ...formData,
                }),
            });
            showSnackbar(
                editingProvider
                    ? t('providers.updated')
                    : t('providers.created'),
                'success'
            );
            fetchProviders();
            handleCloseDialog();
        } catch (e) {
            console.error(e);
            showSnackbar(t('providers.saveFailed'), 'error');
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm(t('providers.confirmDelete')))
            return;
        try {
            await api(`providers/${id}`, { method: 'DELETE' });
            showSnackbar(t('providers.deleted'), 'success');
            fetchProviders();
        } catch (e) {
            console.error(e);
            showSnackbar(t('providers.deleteFailed'), 'error');
        }
    };

    const getTypeColor = (type) => {
        switch (type) {
            case 'gateway':
                return 'primary';
            case 'direct':
                return 'success';
            case 'cloud':
                return 'warning';
            default:
                return 'default';
        }
    };

    const fields = [
        { name: 'name', label: t('common.name'), required: true },
        { name: 'host', label: t('providers.host'), required: true },
        {
            name: 'type',
            label: t('common.type'),
            type: 'select',
            options: PROVIDER_TYPES,
            required: true,
        },
        {
            name: 'codesource',
            label: t('providers.codeSource'),
            type: 'select',
            options: codesources.map((c) => ({ value: c, label: c })),
            required: true,
        },
        { name: 'user', label: t('auth.username'), required: false },
        {
            name: 'password',
            label: t('auth.password'),
            type: 'password',
            required: false,
        },
    ];

    return (
        <Box sx={{ flexGrow: 1, p: 2 }}>
            <Box
                sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    mb: 2,
                }}
            >
                <Typography variant="h4">{t('nav.providers')}</Typography>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => handleOpenDialog()}
                >
                    {t('providers.add')}
                </Button>
            </Box>

            <Card>
                <CardContent>
                    {loading ? (
                        <Typography>{t('common.loading')}</Typography>
                    ) : (
                        <TableContainer>
                            <Table>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>{t('common.name')}</TableCell>
                                        <TableCell>{t('common.type')}</TableCell>
                                        <TableCell>
                                            {t('providers.codeSource')}
                                        </TableCell>
                                        <TableCell>
                                            {t('providers.host')}
                                        </TableCell>
                                        <TableCell>
                                            {t('providers.multidevices')}
                                        </TableCell>
                                        <TableCell align="right">
                                            {t('common.actions')}
                                        </TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {providers.map((provider) => (
                                        <TableRow key={provider._id} hover>
                                            <TableCell>
                                                {provider.name}
                                            </TableCell>
                                            <TableCell>
                                                <Chip
                                                    label={
                                                        provider.type ||
                                                        'gateway'
                                                    }
                                                    color={getTypeColor(
                                                        provider.type
                                                    )}
                                                    size="small"
                                                />
                                            </TableCell>
                                            <TableCell>
                                                {provider.codesource}
                                            </TableCell>
                                            <TableCell>
                                                {provider.host || '-'}
                                            </TableCell>
                                            <TableCell>
                                                {provider.multidevices
                                                    ? t('common.yes')
                                                    : t('common.no')}
                                            </TableCell>
                                            <TableCell align="right">
                                                {provider.codesource ===
                                                    'homeassistant' && (
                                                    <IconButton
                                                        size="small"
                                                        color="primary"
                                                        title={t(
                                                            'providers.configureIntegrations'
                                                        )}
                                                        onClick={() =>
                                                            setHaOpen(true)
                                                        }
                                                    >
                                                        <SettingsIcon />
                                                    </IconButton>
                                                )}
                                                <IconButton
                                                    size="small"
                                                    onClick={() =>
                                                        handleOpenDialog(
                                                            provider
                                                        )
                                                    }
                                                >
                                                    <EditIcon />
                                                </IconButton>
                                                <IconButton
                                                    size="small"
                                                    color="error"
                                                    onClick={() =>
                                                        handleDelete(
                                                            provider._id
                                                        )
                                                    }
                                                >
                                                    <DeleteIcon />
                                                </IconButton>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </CardContent>
            </Card>

            <Dialog
                open={dialogOpen}
                onClose={handleCloseDialog}
                maxWidth="md"
                fullWidth
            >
                <DialogTitle>
                    {editingProvider
                        ? t('providers.edit')
                        : t('providers.add')}
                </DialogTitle>
                <DialogContent>
                    <Box
                        sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            p: 1,
                        }}
                    >
                        {fields.map((field) =>
                            field.type === 'select' ? (
                                <FormControl fullWidth key={field.name}>
                                    <InputLabel id={`${field.name}-label`}>
                                        {field.label}
                                    </InputLabel>
                                    <Select
                                        label={field.label}
                                        value={formData[field.name]}
                                        labelId={`${field.name}-label`}
                                        onChange={(e) =>
                                            setFormData({
                                                ...formData,
                                                [field.name]: e.target.value,
                                            })
                                        }
                                    >
                                        {field.options.map((opt) => (
                                            <MenuItem
                                                value={opt.value}
                                                key={opt.value}
                                            >
                                                {t(opt.labelKey, {
                                                    defaultValue:
                                                        opt.label ?? opt.value,
                                                })}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            ) : (
                                <TextField
                                    fullWidth
                                    key={field.name}
                                    label={field.label}
                                    type={field.type || 'text'}
                                    value={formData[field.name]}
                                    onChange={(e) =>
                                        setFormData({
                                            ...formData,
                                            [field.name]: e.target.value,
                                        })
                                    }
                                    required={field.required}
                                    helperText={field.helperText}
                                />
                            )
                        )}
                        <FormControl fullWidth>
                            <InputLabel id="multidevices-label">
                                {t('providers.multiDevices')}
                            </InputLabel>
                            <Select
                                label={t('providers.multiDevices')}
                                value={formData.multidevices.toString()}
                                labelId="multidevices-label"
                                onChange={(e) =>
                                    setFormData({
                                        ...formData,
                                        multidevices: e.target.value === 'true',
                                    })
                                }
                            >
                                <MenuItem value="true">{t('common.yes')}</MenuItem>
                                <MenuItem value="false">{t('common.no')}</MenuItem>
                            </Select>
                        </FormControl>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseDialog}>
                        {t('common.cancel')}
                    </Button>
                    <Button variant="contained" onClick={handleSubmit}>
                        {editingProvider ? t('common.update') : t('common.create')}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar
                open={snackbar.open}
                autoHideDuration={6000}
                onClose={handleCloseSnackbar}
            >
                <Alert
                    onClose={handleCloseSnackbar}
                    severity={snackbar.severity}
                    variant="filled"
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>

            <IntegrationManager
                open={haOpen}
                onClose={() => setHaOpen(false)}
            />
        </Box>
    );
};
