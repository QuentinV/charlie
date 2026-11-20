import React from 'react';
import { IconButton, Tooltip } from '@mui/material';
import AddHomeIcon from '@mui/icons-material/AddHome';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/charlie';

/**
 * Bottom-left companion of the AI chat button: creates an untitled room and
 * opens it, where it can be renamed (long-press / edit).
 */
export const AddRoomButton = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [creating, setCreating] = React.useState(false);

    const handleClick = async () => {
        if (creating) return;
        setCreating(true);
        try {
            const { uuid } = await api('rooms', {
                method: 'POST',
                body: JSON.stringify({
                    name: t('rooms.untitled'),
                }),
            });
            navigate(`/room/${uuid}`);
        } catch (e) {
            console.warn('Unable to create room', e);
        } finally {
            setCreating(false);
        }
    };

    return (
        <Tooltip title={t('rooms.add')} placement="left">
            <IconButton
                aria-label={t('rooms.add')}
                aria-busy={creating}
                onClick={handleClick}
                sx={{
                    bgcolor: 'primary.main',
                    color: '#111',
                    boxShadow:
                        '0 0 0 1px rgba(255,215,0,.3), 0 4px 20px -4px rgba(255,215,0,.5)',
                    opacity: creating ? 0.6 : 1,
                    pointerEvents: creating ? 'none' : 'auto',
                    '&:hover': {
                        bgcolor: 'secondary.main',
                    },
                }}
            >
                <AddHomeIcon />
            </IconButton>
        </Tooltip>
    );
};

export default AddRoomButton;