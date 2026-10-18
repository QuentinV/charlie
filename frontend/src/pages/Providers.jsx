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
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SettingsIcon from '@mui/icons-material/Settings';

const PROVIDER_TYPES = [
    { value: 'gateway', label: 'Gateway' },
    { value: 'direct', label: 'Direct' },
    { value: 'cloud', label: 'Cloud API' },
];

export const ProvidersPage = () => {
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
            showSnackbar('Failed to load providers', 'error');
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
                editingProvider ? 'Provider updated' : 'Provider created',
                'success'
            );
            fetchProviders();
            handleCloseDialog();
        } catch (e) {
            console.error(e);
            showSnackbar('Failed to save provider', 'error');
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Are you sure you want to delete this provider?'))
            return;
        try {
            await api(`providers/${id}`, { method: 'DELETE' });
            showSnackbar('Provider deleted', 'success');
            fetchProviders();
        } catch (e) {
            console.error(e);
            showSnackbar('Failed to delete provider', 'error');
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
        { name: 'name', label: 'Name', required: true },
        { name: 'host', label: 'Host/IP', required: true },
        {
            name: 'type',
            label: 'Type',
            type: 'select',
            options: PROVIDER_TYPES,
            required: true,
        },
        {
            name: 'codesource',
            label: 'Code Source',
            type: 'select',
            options: codesources.map((c) => ({ value: c, label: c })),
            required: true,
        },
        { name: 'user', label: 'Username', required: false },
        {
            name: 'password',
            label: 'Password',
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
                <Typography variant="h4">Providers</Typography>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => handleOpenDialog()}
                >
                    Add Provider
                </Button>
            </Box>

            <Card>
                <CardContent>
                    {loading ? (
                        <Typography>Loading...</Typography>
                    ) : (
                        <TableContainer>
                            <Table>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Name</TableCell>
                                        <TableCell>Type</TableCell>
                                        <TableCell>Code Source</TableCell>
                                        <TableCell>Host</TableCell>
                                        <TableCell>Multidevices</TableCell>
                                        <TableCell align="right">
                                            Actions
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
                                                    ? 'Yes'
                                                    : 'No'}
                                            </TableCell>
                                            <TableCell align="right">
                                                {provider.codesource ===
                                                    'homeassistant' && (
                                                    <IconButton
                                                        size="small"
                                                        color="primary"
                                                        title="Configure Home Assistant integrations"
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
                    {editingProvider ? 'Edit Provider' : 'Add Provider'}
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
                                                {opt.label}
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
                                Multiple Devices
                            </InputLabel>
                            <Select
                                label="Multiple Devices"
                                value={formData.multidevices.toString()}
                                labelId="multidevices-label"
                                onChange={(e) =>
                                    setFormData({
                                        ...formData,
                                        multidevices: e.target.value === 'true',
                                    })
                                }
                            >
                                <MenuItem value="true">Yes</MenuItem>
                                <MenuItem value="false">No</MenuItem>
                            </Select>
                        </FormControl>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseDialog}>Cancel</Button>
                    <Button variant="contained" onClick={handleSubmit}>
                        {editingProvider ? 'Update' : 'Create'}
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
