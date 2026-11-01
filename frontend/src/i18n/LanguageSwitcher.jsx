import React from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import TranslateIcon from '@mui/icons-material/Translate';
import { changeLanguage } from './index';

/** Displayed in their own language, so a user never has to read the wrong one. */
const LANGUAGES = [
    { code: 'fr', label: 'Français' },
    { code: 'en', label: 'English' },
];

export const LanguageSwitcher = ({ size = 'medium', color = 'inherit' }) => {
    const { t, i18n } = useTranslation();
    const [anchorEl, setAnchorEl] = React.useState(null);
    const open = Boolean(anchorEl);

    return (
        <>
            <Tooltip title={t('common.changeLanguage')}>
                <IconButton
                    color={color}
                    size={size}
                    aria-label={t('common.changeLanguage')}
                    onClick={(e) => setAnchorEl(e.currentTarget)}
                >
                    <TranslateIcon fontSize="small" />
                </IconButton>
            </Tooltip>
            <Menu
                anchorEl={anchorEl}
                open={open}
                onClose={() => setAnchorEl(null)}
            >
                {LANGUAGES.map((lang) => (
                    <MenuItem
                        key={lang.code}
                        selected={i18n.language?.startsWith(lang.code)}
                        onClick={() => {
                            changeLanguage(lang.code);
                            setAnchorEl(null);
                        }}
                    >
                        {lang.label}
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
};
