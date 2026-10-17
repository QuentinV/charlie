import { api } from '../../api/charlie';

/**
 * Persist a state change (`{ power?, level?, properties? }`) for a device and
 * propagate the resulting state back to the caller.
 *
 * @param {any} device The device being controlled
 * @param {{ power?: string, level?: number, properties?: Record<string, any> }} state
 * @param {(newState: any) => void} onStateChange
 * @returns {Promise<any>} The updated state returned by the API
 */
export const updateState = async (device, state, onStateChange) => {
    const res = await api(`devices/${device?._id}/state`, {
        method: 'PUT',
        body: JSON.stringify(state),
    });
    if (res) {
        onStateChange?.(res?.res);
        return res?.res;
    }
    return undefined;
};

/**
 * Call a device function advertised through `capabilities.functions`
 * (`POST devices/:id/functions/:name`).
 *
 * @param {string} deviceId
 * @param {string} name Function name, as advertised (`media_player.media_play`)
 * @param {Record<string, any>} [params] Function input values
 * @returns {Promise<any>}
 */
export const callDeviceFunction = (deviceId, name, params = undefined) =>
    api(`devices/${deviceId}/functions/${name}`, {
        method: 'POST',
        body: JSON.stringify(params ?? {}),
    });
