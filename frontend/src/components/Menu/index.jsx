import React from 'react';
import {
    AppBar,
    Toolbar,
    Typography,
    IconButton,
    Drawer,
    List,
    ListItem,
    ListItemText,
    Box,
    Button,
    useTheme,
    useMediaQuery,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { useNavigate } from 'react-router-dom';

export const Menu = () => {
    const theme = useTheme();
    const [drawerOpen, setDrawerOpen] = React.useState(false);
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const navigate = useNavigate();

    const navItems = ['Home', 'Routines', 'Discover'];

    return (
        <>
            <AppBar position="static">
                <Toolbar>
                    {isMobile && (
                        <IconButton
                            edge="start"
                            color="inherit"
                            aria-label="menu"
                            onClick={() => setDrawerOpen(true)}
                        >
                            <MenuIcon />
                        </IconButton>
                    )}
                    <Typography
                        variant="h6"
                        sx={{
                            flexGrow: 1,
                            display: 'flex',
                            alignItems: 'center',
                            cursor: 'pointer',
                        }}
                        onClick={() => navigate('/')}
                    >
                        <img
                            src="/dark_icon.png"
                            width="30"
                            style={{ marginRight: '10px' }}
                        />
                        Charlie
                    </Typography>
                    {!isMobile &&
                        navItems.map((item) => (
                            <Button
                                key={item}
                                color="inherit"
                                sx={{ marginLeft: '1rem' }}
                            >
                                {item}
                            </Button>
                        ))}
                </Toolbar>
            </AppBar>
            <Drawer
                anchor="left"
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
            >
                <Box sx={{ width: 250 }} role="presentation">
                    <List>
                        {navItems.map((text) => (
                            <ListItem
                                button
                                key={text}
                                onClick={() => setDrawerOpen(false)}
                            >
                                <ListItemText primary={text} />
                            </ListItem>
                        ))}
                    </List>
                </Box>
            </Drawer>
        </>
    );
};
