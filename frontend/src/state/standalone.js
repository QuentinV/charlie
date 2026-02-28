import { createEvent, createStore } from 'effector';

export const $pwaPrompt = createStore(null);
export const setPwaPrompt = createEvent();
$pwaPrompt.on(setPwaPrompt, (_, state) => state);
