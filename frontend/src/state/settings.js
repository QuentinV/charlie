import { createEffect, createEvent, createStore } from 'effector';
import { api } from '../api/charlie';

const $settings = createStore({});
const $schema = createStore({});
/** True once the first load settled (success or failure: no infinite spinner). */
const $loaded = createStore(false);

const update = createEvent();
$settings.on(update, (_, v) => v);

const loadFx = createEffect(async () => api('settings'));
$settings.on(loadFx.doneData, (_, state) => state.settings);
$schema.on(loadFx.doneData, (_, state) => state.schema);
$loaded.on(loadFx.doneData, () => true);
$loaded.on(loadFx.fail, () => true);

export const settings = {
    $settings,
    $schema,
    $loaded,
    loadFx,
    update,
};
