import React, { useState } from 'react';
import { IconButton, Menu, MenuItem } from '@mui/material';
import CastIcon from '@mui/icons-material/Cast';

export default function DeviceSelector({ devices, currentDevice, onSelect }) {
    const [anchor, setAnchor] = useState(null);

    return (
        <>
            <IconButton onClick={(e) => setAnchor(e.currentTarget)}>
                <CastIcon />
            </IconButton>

            <Menu
                anchorEl={anchor}
                open={Boolean(anchor)}
                onClose={() => setAnchor(null)}
            >
                {devices.map((d) => (
                    <MenuItem
                        key={d.id}
                        selected={d.id === currentDevice}
                        onClick={() => {
                            onSelect(d.id);
                            setAnchor(null);
                        }}
                    >
                        {d.name}
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
}
