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