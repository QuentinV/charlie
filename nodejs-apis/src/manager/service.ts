import { cs } from '../core/db';
import { Room } from '../types';

export async function manageDeviceRoom(deviceId: string, room?: Room) {
    const oldRoom = await cs.rooms.findOne({ devices: deviceId });
    if (oldRoom) {
        await cs.rooms.updateOne(
            { _id: oldRoom._id },
            {
                $set: {
                    devices: (oldRoom.devices ?? []).filter(
                        (d: string) => d !== deviceId
                    ),
                },
            }
        );
    }

    if (room) {
        const devices = new Set(room.devices);
        devices.add(deviceId);
        await cs.rooms.updateOne(
            { _id: room._id },
            { $set: { devices: [...devices] } }
        );
    }
}
