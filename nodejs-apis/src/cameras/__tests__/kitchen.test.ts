/**
 * The fridge/pantry flow: a camera whose selection includes the `grocery` mode →
 * the event's keyframe → the items the VLM sees → the shopping list (raw first).
 *
 * The model, the list, the frame store and the camera lookup are stubbed, so what
 * is under test is the decision (mode selected, class watched, event kind,
 * cooldown) and the wiring.
 */
jest.mock('../index', () => ({
    loadCamera: jest.fn(),
}));
jest.mock('../keyframes', () => ({ readKeyframe: jest.fn() }));
jest.mock('../snapshot', () => ({ fetchSnapshot: jest.fn() }));
jest.mock('../../ai/llm', () => ({ visionJson: jest.fn() }));
jest.mock('../../shopping/list', () => ({
    addRequests: jest.fn(async (texts: string[]) => texts),
}));
jest.mock('../../shopping/restructure', () => ({
    shoppingEnabled: jest.fn(() => true),
    scheduleRestructure: jest.fn(),
}));
jest.mock('../../manager/services/activities', () => ({ log: jest.fn() }));

import { visionJson } from '../../ai/llm';
import { addRequests } from '../../shopping/list';
import {
    scheduleRestructure,
    shoppingEnabled,
} from '../../shopping/restructure';
import { VisionEvent } from '../../types';
import { loadCamera } from '../index';
import { readKeyframe } from '../keyframes';
import {
    DEFAULT_GROCERY_COOLDOWN_S,
    addGroceryItemsFromImage,
    eventImage,
    groceryDue,
    onVisionEvent,
} from '../kitchen';
import { VISION_MODES, visionModesOf } from '../modes';
import { fetchSnapshot } from '../snapshot';

// (the module stubs above are cleared in beforeEach)

/** The selection of the camera that looks at the shelves. */
const GROCERY = visionModesOf('grocery');

const dwell = (over: Partial<VisionEvent> = {}): VisionEvent => ({
    at: 1000,
    cameraId: 'cam-1',
    modes: ['grocery'],
    kind: 'dwell',
    classes: ['person'],
    ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    (shoppingEnabled as jest.Mock).mockReturnValue(true);
    (loadCamera as jest.Mock).mockResolvedValue(null);
});

describe('groceryDue', () => {
    it('accepts a grocery camera on an arrival', () => {
        for (const kind of ['enter', 'dwell', 'appear'] as const) {
            expect(groceryDue(dwell({ kind }), GROCERY, undefined, 0)?.id).toBe(
                'grocery'
            );
        }
    });

    it('ignores a camera that did not select the grocery mode', () => {
        expect(
            groceryDue(dwell(), visionModesOf('presence'), undefined, 0)
        ).toBeUndefined();
        expect(groceryDue(dwell(), [], undefined, 0)).toBeUndefined();
    });

    it('ignores an arrival of a class that mode does not watch', () => {
        expect(
            groceryDue(dwell({ classes: ['cat'] }), GROCERY, undefined, 0)
        ).toBeUndefined();
    });

    it('ignores the leaving half of the visit', () => {
        for (const kind of [
            'leave',
            'disappear',
            'motion',
            'gesture',
        ] as const) {
            expect(
                groceryDue(dwell({ kind }), GROCERY, undefined, 0)
            ).toBeUndefined();
        }
    });

    it('holds off until the mode cooldown has elapsed', () => {
        // The `grocery` mode declares a 300 s gap between two looks.
        expect(groceryDue(dwell(), GROCERY, 0, 299_999)).toBeUndefined();
        expect(groceryDue(dwell(), GROCERY, 0, 300_000)?.id).toBe('grocery');
    });

    it('uses a one-minute default when the mode declares no cooldown', () => {
        const bare = [
            { ...VISION_MODES.find((m) => m.grocery)!, cooldownS: undefined },
        ];
        const wait = DEFAULT_GROCERY_COOLDOWN_S * 1000;
        expect(groceryDue(dwell(), bare, 0, wait - 1)).toBeUndefined();
        expect(groceryDue(dwell(), bare, 0, wait)?.id).toBe('grocery');
    });
});

describe('eventImage', () => {
    const device: any = { _id: 'cam-1', externalId: 'webcam-host', provider: 'p-1' };
    const provider: any = {
        _id: 'p-1',
        codesource: 'camera',
        host: 'http://cam',
        properties: { kind: 'mjpeg' },
    };

    it('prefers the keyframe the event carries (any source kind)', async () => {
        (readKeyframe as jest.Mock).mockReturnValue(Buffer.from('jpeg'));
        (fetchSnapshot as jest.Mock).mockResolvedValue(
            'data:image/jpeg;base64,snap'
        );

        const image = await eventImage(
            dwell({ keyframeUrl: '/api/vision/keyframes/abc123.jpg' }),
            device,
            provider
        );

        expect(readKeyframe).toHaveBeenCalledWith('abc123.jpg');
        expect(fetchSnapshot).not.toHaveBeenCalled();
        expect(image).toBe(
            `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}`
        );
    });

    it('falls back to a snapshot when the keyframe was rotated away', async () => {
        (readKeyframe as jest.Mock).mockReturnValue(undefined);
        (fetchSnapshot as jest.Mock).mockResolvedValue(
            'data:image/jpeg;base64,snap'
        );

        expect(await eventImage(dwell(), device, provider)).toBe(
            'data:image/jpeg;base64,snap'
        );
        expect(fetchSnapshot).toHaveBeenCalledWith(device, provider);
    });

    it('returns nothing when neither the keyframe nor a snapshot exists', async () => {
        (readKeyframe as jest.Mock).mockReturnValue(undefined);
        (fetchSnapshot as jest.Mock).mockResolvedValue(undefined);

        expect(await eventImage(dwell(), device, provider)).toBeUndefined();
    });
});

describe('addGroceryItemsFromImage', () => {
    it('appends what the model saw and schedules the restructure', async () => {
        (visionJson as jest.Mock).mockResolvedValue(
            '{"items":["lait","oeufs","lait"]}'
        );

        const items = await addGroceryItemsFromImage(
            'data:image/jpeg;base64,x',
            'Frigo',
            'jane'
        );

        expect(items).toEqual(['lait', 'oeufs']);
        expect(addRequests).toHaveBeenCalledWith(
            ['lait', 'oeufs'],
            'camera',
            'jane'
        );
        expect(scheduleRestructure).toHaveBeenCalled();
    });

    it('adds nothing when the model answers something else', async () => {
        (visionJson as jest.Mock).mockResolvedValue('nothing on the shelf');

        expect(
            await addGroceryItemsFromImage('data:image/jpeg;base64,x')
        ).toEqual([]);
        expect(addRequests).not.toHaveBeenCalled();
    });
});

/** The cameras the fridge flow may look at (anything else → no camera). */
const CAMERA_MODES: { [cameraId: string]: string } = {
    'cam-fridge': 'grocery',
    'cam-off': 'grocery',
    'cam-cooldown': 'grocery',
    'cam-broken': 'grocery',
    // A camera that also watches the cat: only a person is a look at the shelves.
    'cam-cat': 'grocery,pet',
    'cam-nomodes': '',
};

describe('onVisionEvent', () => {
    beforeEach(() => {
        (readKeyframe as jest.Mock).mockReturnValue(Buffer.from('jpeg'));
        // One camera per test: the cooldown lives in module state (a real
        // camera cannot be looked at twice in a row either).
        (loadCamera as jest.Mock).mockImplementation(async (id: string) =>
            id in CAMERA_MODES
                ? {
                      device: {
                          _id: id,
                          externalId: 'webcam-host',
                          provider: 'p-1',
                          properties: { visionModes: CAMERA_MODES[id] },
                      },
                      provider: {
                          _id: 'p-1',
                          codesource: 'camera',
                          host: 'http://cam',
                          properties: { kind: 'mjpeg' },
                      },
                  }
                : null
        );
    });

    it('adds what the fridge camera sees', async () => {
        (visionJson as jest.Mock).mockResolvedValue('{"items":["beurre"]}');

        await onVisionEvent(
            dwell({
                cameraId: 'cam-fridge',
                keyframeUrl: '/api/vision/keyframes/k.jpg',
            })
        );

        expect(visionJson).toHaveBeenCalled();
        expect(addRequests).toHaveBeenCalledWith(
            ['beurre'],
            'camera',
            undefined
        );
    });

    it('ignores a camera that did not select the grocery mode', async () => {
        await onVisionEvent(dwell({ cameraId: 'cam-nomodes' }));
        expect(visionJson).not.toHaveBeenCalled();
    });

    it('ignores an arrival of a class the grocery mode does not watch', async () => {
        await onVisionEvent(
            dwell({
                cameraId: 'cam-cat',
                classes: ['cat'],
                keyframeUrl: '/api/vision/keyframes/k.jpg',
            })
        );
        expect(visionJson).not.toHaveBeenCalled();
    });

    it('does nothing when the shopping list is disabled', async () => {
        (shoppingEnabled as jest.Mock).mockReturnValue(false);

        await onVisionEvent(dwell({ cameraId: 'cam-off' }));

        expect(visionJson).not.toHaveBeenCalled();
    });

    it('looks at a camera only once per cooldown', async () => {
        (visionJson as jest.Mock).mockResolvedValue('{"items":["lait"]}');
        const event = dwell({
            cameraId: 'cam-cooldown',
            keyframeUrl: '/api/vision/keyframes/k.jpg',
        });

        await onVisionEvent(event);
        await onVisionEvent(event);

        expect(visionJson).toHaveBeenCalledTimes(1);
    });

    it('never throws when the model fails', async () => {
        (visionJson as jest.Mock).mockRejectedValue(new Error('router down'));

        await expect(
            onVisionEvent(
                dwell({
                    cameraId: 'cam-broken',
                    keyframeUrl: '/api/vision/keyframes/k.jpg',
                })
            )
        ).resolves.toBeUndefined();
        expect(addRequests).not.toHaveBeenCalled();
    });
});
