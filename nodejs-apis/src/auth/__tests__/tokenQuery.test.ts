/**
 * The `?token=` exception: only the camera stream route accepts one, and only on
 * GET. Everything else must keep using the Authorization header, so no other
 * endpoint gains a token-in-URL surface.
 */
import {
    acceptsTokenInQuery,
    readQueryToken,
} from '../middleware';

describe('acceptsTokenInQuery', () => {
    it('accepts the camera stream route', () => {
        expect(
            acceptsTokenInQuery('GET', '/api/devices/cam-1/stream')
        ).toBe(true);
        expect(
            acceptsTokenInQuery('get', '/api/devices/cam-1/stream/')
        ).toBe(true);
    });

    it('accepts the vision-feed relay route (cv2 cannot send a header)', () => {
        expect(
            acceptsTokenInQuery('GET', '/api/vision/feeds/cam-1/stream')
        ).toBe(true);
    });

    it('accepts nothing else — not even the sibling routes', () => {
        for (const path of [
            '/api/devices/cam-1/snapshot',
            '/api/devices/cam-1',
            '/api/devices/cam-1/stream/extra',
            '/api/vision/feeds',
            '/api/vision/feeds/cam-1',
            '/api/vision/keyframes/abc.jpg',
            '/api/settings',
        ]) {
            expect(acceptsTokenInQuery('GET', path)).toBe(false);
        }
    });

    it('is GET only (a token must not ride a write)', () => {
        expect(acceptsTokenInQuery('POST', '/api/devices/cam-1/stream')).toBe(
            false
        );
        expect(acceptsTokenInQuery('PUT', '/api/devices/cam-1/stream')).toBe(
            false
        );
    });
});

describe('readQueryToken', () => {
    it('reads a plain value and trims it', () => {
        expect(readQueryToken({ token: ' chk_abc ' })).toBe('chk_abc');
    });

    it('takes the first of a repeated parameter', () => {
        expect(readQueryToken({ token: ['chk_a', 'chk_b'] })).toBe('chk_a');
    });

    it('is null when absent, empty or not a string', () => {
        expect(readQueryToken(undefined)).toBeNull();
        expect(readQueryToken({})).toBeNull();
        expect(readQueryToken({ token: '' })).toBeNull();
        expect(readQueryToken({ token: '   ' })).toBeNull();
        expect(readQueryToken({ token: { evil: true } })).toBeNull();
    });
});
