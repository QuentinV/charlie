import React from 'react';
import { ClimatePanel } from '../panels/ClimatePanel';

/**
 * Premium AC panel — the `clim` control profile advertised by providers
 * (any Home Assistant `climate.*` entity, whatever integration produced it).
 *
 * Thin wrapper: the implementation lives in the shared `ClimatePanel`, so this
 * file only maps the registry key to a variant.
 */
export const ACControls = (props) => <ClimatePanel {...props} variant="clim" />;

export default ACControls;
