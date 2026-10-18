import echoStatus from './echo_status';
import deviceState from './device_state';
import { MqttSubscriber } from '../../types';

// Core (non-provider) subscribers, mounted at startup.
const coreSubscribers: Record<string, MqttSubscriber> = {
    ...echoStatus,
    ...deviceState,
};

// Topics registered by providers (e.g. shelly registers 'shelly/events/rpc').
// Resolved at MQTT connect-time so provider module evaluation order doesn't
// matter — see receive.ts.
const providerSubscribers: Record<string, MqttSubscriber> = {};

export function registerProviderSubscribers(
    subs: Record<string, MqttSubscriber>
): void {
    Object.assign(providerSubscribers, subs);
}

export function getAllSubscribers(): Record<string, MqttSubscriber> {
    return { ...coreSubscribers, ...providerSubscribers };
}
