import React from 'react';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import DeviceThermostatIcon from '@mui/icons-material/DeviceThermostat';
import TvIcon from '@mui/icons-material/Tv';
import PowerIcon from '@mui/icons-material/Power';
import SwitchLeftIcon from '@mui/icons-material/SwitchLeft';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import DoorbellIcon from '@mui/icons-material/Doorbell';
import SmartButtonIcon from '@mui/icons-material/SmartButton';
import SensorsIcon from '@mui/icons-material/Sensors';
import BlindsIcon from '@mui/icons-material/Blinds';

const icons = {
    light: <LightbulbIcon />,
    switch: <SwitchLeftIcon />,
    shutter: <BlindsIcon />,
    sprinkler: <WaterDropIcon />,
    tv: <TvIcon />,
    sensor: <SensorsIcon />,
    button: <SmartButtonIcon />,
    thermostat: <DeviceThermostatIcon />,
    doorbell: <DoorbellIcon />,
};

export const DeviceIcon = ({ type }) => icons[type] ?? <PowerIcon />;
