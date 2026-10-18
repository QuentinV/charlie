import { createEvent, createStore } from 'effector';

export const setAddActions = createEvent();

export const $addActions = createStore(/** @type {AddActions} */ ([]));

$addActions.on(setAddActions, (_, actions) => actions);
