import { createEffect, createEvent, createStore } from 'effector';
import { api } from '../api/charlie';

const $settings = createStore({});
const $schema = createStore({});

const update = createEvent();
$settings.on(update, (_, v) => v);

const loadFx = createEffect(async () => api('settings'));
$settings.on(loadFx.doneData, (_, state) => state.settings);
$schema.on(loadFx.doneData, (_, state) => state.schema);

export const settings = {
    $settings,
    $schema,
    loadFx,
    update,
};
