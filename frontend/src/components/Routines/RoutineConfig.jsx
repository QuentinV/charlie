import React, { useCallback, useEffect, useState } from 'react';
import {
    Box,
    TextField,
    Typography,
    Switch,
    ToggleButton,
    ToggleButtonGroup,
    Paper,
    IconButton,
    List,
    ListItem,
    ListItemText,
    InputAdornment,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Button,
} from '@mui/material';
import { Delete, Add, Schedule } from '@mui/icons-material';
import { CronEditor } from './CronEditor';
import { api } from '../../api/charlie';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import { useNavigate } from 'react-router-dom';

const DEFAULT = {
    name: '',
    active: true,
    actions: [],
    triggers: [
        {
            type: 'CRON',
            obj: { expression: '00 09 * * *' },
        },
    ],
};

export const RoutineConfig = ({ id }) => {
    const [currentAction, setCurrentAction] = useState('');
    const [state, setState] = useState(DEFAULT);
    const [dialogDeleteVisible, setDialogDeleteVisible] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        if (!id || id === 'new') {
            setState(DEFAULT);
            return;
        }
        api(`routines/${id}`).then((res) => setState(res));
    }, [navigate, id]);

    const addAction = useCallback(() => {
        if (currentAction.trim()) {
            setState({
                ...state,
                actions: [...state.actions, currentAction.trim()],
            });
            setCurrentAction('');
        }
    }, [state, currentAction]);

    const removeAction = useCallback(
        (index) => {
            setState({
                ...state,
                actions: state.actions.filter((_, i) => i !== index),
            });
        },
        [state]
    );

    const save = useCallback(async () => {
        const res = await api(`routines`, {
            method: 'POST',
            body: JSON.stringify(state),
        });
        if (id === 'new') {
            navigate(`/rountine/${res.uuid}`);
        }
    }, [navigate, id, state]);

    const remove = useCallback(async () => {
        await api(`routines/${id}`, { method: 'DELETE' });
        setDialogDeleteVisible(false);
    }, [setDialogDeleteVisible, id]);

    if (!state) return;

    return (
        <>
            <Box sx={{ mx: 'auto' }}>
                <Box display="flex" justifyContent="end" alignItems="center">
                    <IconButton>
                        <SaveIcon onClick={save} />
                    </IconButton>
                    <IconButton>
                        <DeleteIcon
                            onClick={() => setDialogDeleteVisible(true)}
                        />
                    </IconButton>
                </Box>
                <Paper elevation={3} sx={{ p: 2, borderRadius: 2 }}>
                    <Box mb={1}>
                        <TextField
                            variant="standard"
                            placeholder="Routine Name (e.g. Morning Sync)"
                            value={state.name}
                            onChange={(e) =>
                                setState({ ...state, name: e.target.value })
                            }
                            fullWidth
                        />
                    </Box>

                    <Box>
                        <ToggleButtonGroup
                            value={state.triggers?.[0]?.type}
                            exclusive
                            onChange={(_, val) =>
                                val &&
                                setState((prev) => ({
                                    ...prev,
                                    triggers: [
                                        {
                                            ...(state.triggers?.[0] ?? {}),
                                            type: val,
                                        },
                                    ],
                                }))
                            }
                            fullWidth
                            color="primary"
                        >
                            <ToggleButton value="CRON">
                                <Schedule sx={{ mr: 1 }} /> CRON
                            </ToggleButton>
                        </ToggleButtonGroup>
                    </Box>

                    {state.triggers?.[0]?.type === 'CRON' && (
                        <CronEditor
                            value={state.triggers?.[0]?.obj?.expression}
                            onChange={(v) => {
                                setState((prev) => ({
                                    ...prev,
                                    triggers: [
                                        {
                                            type: 'CRON',
                                            obj: { expression: v },
                                        },
                                    ],
                                }));
                            }}
                        />
                    )}

                    <Typography variant="h6" mt={3} gutterBottom>
                        Actions
                    </Typography>

                    <Box sx={{ borderRadius: 1 }}>
                        <List dense>
                            {state.actions.map((action, index) => (
                                <ListItem
                                    key={index}
                                    secondaryAction={
                                        <IconButton
                                            edge="end"
                                            onClick={() => removeAction(index)}
                                            size="small"
                                        >
                                            <Delete
                                                fontSize="small"
                                                color="error"
                                            />
                                        </IconButton>
                                    }
                                >
                                    <Box sx={{ px: 1 }}>-</Box>
                                    <ListItemText primary={action} />
                                </ListItem>
                            ))}
                        </List>

                        <TextField
                            fullWidth
                            size="small"
                            placeholder="Action (e.g. 'Allume la lumiere du salon...')"
                            value={currentAction}
                            onChange={(e) => setCurrentAction(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addAction()}
                            slotProps={{
                                input: {
                                    endAdornment: (
                                        <InputAdornment position="end">
                                            <IconButton
                                                onClick={addAction}
                                                color="primary"
                                            >
                                                <Add />
                                            </IconButton>
                                        </InputAdornment>
                                    ),
                                },
                            }}
                            sx={{ mt: 1, color: 'black' }}
                        />
                    </Box>
                </Paper>
            </Box>
            <Dialog
                open={dialogDeleteVisible}
                onClose={() => setDialogDeleteVisible(false)}
            >
                <DialogTitle>Confirm</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Are you sure you want to delete this item? This action
                        cannot be undone.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => setDialogDeleteVisible(false)}
                        color="primary"
                    >
                        Cancel
                    </Button>
                    <Button onClick={() => remove()} color="error" autoFocus>
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
