import { createEvent, createStore } from 'effector';

const $settings = createStore({});
const updateSettings = createEvent();
$settings.on(updateSettings, (_, v) => v);

function createBoolSetting(key, defaultValue) {
    const $store = createStore(defaultValue);
    $store.on($settings.updates, (_, v) => v?.[key]);
    return $store;
}

export const settingsStore = {
    $settings,
    $showMusicPlayer: createBoolSetting('music.player.show', false),
    $showAiAsk: createBoolSetting('ai.ask.show', false),
    $enableAddDevice: createBoolSetting('devices.add.enabled', false),
    $enableAddRoom: createBoolSetting('rooms.add.enabled', true),
    $enableAddRoutine: createBoolSetting('routines.add.enabled', true),
    $devicesDiscovery: createBoolSetting('devices.discovery.enabled', false),
    $echosMenu: createBoolSetting('echos.menu.enabled', false),
};
