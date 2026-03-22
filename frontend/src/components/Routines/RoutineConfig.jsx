import React, { useState } from 'react';
import {
    Box,
    TextField,
    Typography,
    Switch,
    FormControlLabel,
    ToggleButton,
    ToggleButtonGroup,
    Paper,
    IconButton,
    List,
    ListItem,
    ListItemText,
    Divider,
    InputAdornment,
} from '@mui/material';
import { Delete, Add, Schedule } from '@mui/icons-material';
import { CronEditor } from './CronEditor';

export const RoutineConfig = () => {
    const [name, setName] = useState('');
    const [type, setType] = useState('CRON');
    const [enabled, setEnabled] = useState(true);
    const [currentAction, setCurrentAction] = useState('');
    const [actions, setActions] = useState([]);
    const [cronExpression, setCronExpression] = useState('');

    const addAction = () => {
        if (currentAction.trim()) {
            setActions([...actions, currentAction.trim()]);
            setCurrentAction('');
        }
    };

    const removeAction = (index) => {
        setActions(actions.filter((_, i) => i !== index));
    };

    return (
        <Box sx={{ maxWidth: 600, mx: 'auto', p: 3 }}>
            <Paper elevation={3} sx={{ p: 4, borderRadius: 2 }}>
                <Box
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                >
                    <TextField
                        variant="standard"
                        placeholder="Routine Name (e.g. Morning Sync)"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        fullWidth
                        slotProps={{
                            input: {
                                style: { fontSize: 24, fontWeight: 'bold' },
                            },
                        }}
                    />
                    <FormControlLabel
                        control={
                            <Switch
                                checked={enabled}
                                onChange={(e) => setEnabled(e.target.checked)}
                                color="success"
                            />
                        }
                        label={enabled ? 'Active' : 'Paused'}
                        labelPlacement="top"
                    />
                </Box>

                <Box>
                    <ToggleButtonGroup
                        value={type}
                        exclusive
                        onChange={(_, val) => val && setType(val)}
                        fullWidth
                        color="primary"
                    >
                        <ToggleButton value="CRON">
                            <Schedule sx={{ mr: 1 }} /> CRON
                        </ToggleButton>
                    </ToggleButtonGroup>
                </Box>

                {type === 'CRON' && (
                    <CronEditor
                        value={cronExpression}
                        onChange={setCronExpression}
                    />
                )}

                <Typography variant="h6" mt={3} gutterBottom>
                    Actions
                </Typography>

                <Box sx={{ borderRadius: 1 }}>
                    <List dense>
                        {actions.map((action, index) => (
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
    );
};
