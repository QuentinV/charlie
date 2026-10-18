import React from 'react';
import { MediaPanel } from '../panels/MediaPanel';

/**
 * `tv` control panel — the same media panel as any `media_player`-backed
 * device, so every television renders identically whatever its gateway.
 *
 * The panel is driven by the standard device contract (`state.power`,
 * `state.level`, the properties bag) plus the provider functions
 * (`remote.send_command`, `media_player.select_source`, `media_player.media_*`).
 */
export const TVDefaultControls = (props) => <MediaPanel {...props} />;

export default TVDefaultControls;
