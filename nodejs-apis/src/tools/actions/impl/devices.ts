import { Tools } from '../../../types';
import { t } from '../langs';

interface DeviceRequest {
    device?: string;
    room?: string;
    device_name?: string;
}

interface DeviceValueRequest extends DeviceRequest {
    value: string;
}

export const tools: Tools = {
    turn_on_device: {
        exec: async ({ device, room, device_name }: DeviceRequest) => '',
    },
    turn_off_device: {
        exec: async ({ device, room, device_name }: DeviceRequest) => '',
    },
    //set_device_value: {
    //    exec: async () => '',
    //},
    //increase_device_value: {
    //    exec: async () => '',
    //},
    //decrease_device_value: {
    //    exec: async () => '',
    //},
    query_device_state: {
        exec: async () => '',
    },
    open_shutter: {
        exec: async () => '',
    },
    close_shutter: {
        exec: async () => '',
    },
    pause_shutter: {
        exec: async () => '',
    },
    turn_on_group: {
        exec: async () => '',
    },
    turn_off_group: {
        exec: async () => '',
    },
};

export default tools;
