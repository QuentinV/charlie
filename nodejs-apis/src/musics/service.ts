import 'dotenv/config';
import { settings } from '../manager/services/settings';

function getAuthHeaders() {
    const headers: any = { Aokccept: 'application/json' };
    if (settings?.music?.assistant?.apikey) {
        headers['Authorization'] = 'Bearer ' + settings.music.assistant.apikey;
    }
    return headers;
}

async function callRemoteRpc(command: string, args: object = {}) {
    if (!settings?.music?.assistant?.url) {
        throw new Error('settings music assistant url not configured');
    }
    const headers: any = getAuthHeaders();
    headers['Content-Type'] = 'application/json';
    const res = await fetch(`${settings.music.assistant.url}/api`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ command, args }),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Remote call failed: ${res.status}`);
    }
    return res.json();
}

async function getDefaultQueueId(): Promise<string> {
    const players: any = await callRemoteRpc('players/all', {});
    return (
        players?.find((p) => p.name === settings?.music?.assitant?.playername)
            ?.player_id ??
        players?.[0]?.player_id ??
        ''
    );
}

interface Result {
    item_id: string;
    name: string;
    is_playable: boolean;
    artists: Result[];
}

/**
 * Search the remote music library.
 * @param param0 - Object containing `q` the query string
 * @returns Promise resolving to array of matched song objects
 */
export async function searchLibrary({ q }: { q: string }): Promise<Result[]> {
    q = q?.trim();
    if (!q) return [];
    try {
        const result: any = await callRemoteRpc('music/search', {
            search_query: q,
            limit: 50,
        });
        if (Array.isArray(result)) return result;
        if (Array.isArray(result?.tracks)) return result.tracks;
        if (Array.isArray(result?.tracks?.items)) return result.tracks.items;
    } catch (e) {
        console.log(e);
    }
    return [];
}

/**
 * Send a control command to the remote player (play/pause/skip/etc.).
 * Uses Music Assistant public `/api` command endpoint.
 * @param param0 - Object with keys: `command`, optional `volume`, `songId`
 */
export async function executeCommand({ command, volume, songId }: any) {
    const queue_id = await getDefaultQueueId();
    switch (command) {
        case 'play':
            if (songId) {
                try {
                    const trackInfo = await callRemoteRpc(
                        'music/tracks/get_track',
                        {
                            item_id: songId,
                            provider_instance_id_or_domain: 'library',
                        }
                    );

                    const artistName = trackInfo?.artists?.[0]?.sort_name ?? '';
                    let fallbackUris = [];
                    if (artistName) {
                        const searchResults = await searchLibrary({
                            q: artistName,
                        });
                        fallbackUris =
                            searchResults
                                ?.filter((t: any) => t.item_id !== songId)
                                .map((t: any) => t.uri) || [];
                    }

                    return callRemoteRpc('player_queues/play_media', {
                        queue_id,
                        media: [trackInfo.uri, ...fallbackUris],
                        option: 'replace',
                    });
                } catch (e) {
                    console.log(e);
                }
            }
            return await callRemoteRpc('player_queues/cmd/play', { queue_id });
        case 'pause':
            return await callRemoteRpc('player_queues/cmd/pause', { queue_id });
        case 'resume':
            return await callRemoteRpc('player_queues/cmd/play', { queue_id });
        case 'stop':
            return await callRemoteRpc('player_queues/cmd/stop', { queue_id });
        case 'skip':
            return await callRemoteRpc('player_queues/cmd/next', { queue_id });
        case 'increaseVolume':
        case 'decreaseVolume':
            if (typeof volume === 'number') {
                return await callRemoteRpc('player_queues/cmd/set_volume', {
                    queue_id,
                    volume_level: volume,
                });
            }
            throw new Error(`Unsupported volume command: ${command}`);
        default:
            throw new Error(`Unsupported command: ${command}`);
    }
}

// S11-1 @ cube-serv
