import { Tools } from '../../types';
import { z } from 'zod';
import * as cheerio from 'cheerio';

const DELUGE_URL = `http://${process.env.TORRENT_DELUGE_HOST}/json`;

async function delugeLogin() {
    const res = await fetch(DELUGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            method: 'auth.login',
            params: [process.env.TORRENT_DELUGE_PASSWORD],
            id: 1,
        }),
    });

    const data: any = await res.json();
    return data?.result === true ? res.headers.get('set-cookie') : undefined;
}

async function delugeAddMagnet(magnetUrl: string) {
    const cookie = await delugeLogin();
    const res = await fetch(DELUGE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
        },
        body: JSON.stringify({
            method: 'web.add_torrents',
            params: [
                [
                    {
                        path: magnetUrl,
                        options: {
                            file_priorities: [],
                            add_paused: false,
                            sequential_download: false,
                            pre_allocate_storage: false,
                            download_location: '/downloads',
                            move_completed: true,
                            move_completed_path: '/media',
                            max_connections: -1,
                            max_download_speed: -1,
                            max_upload_slots: -1,
                            max_upload_speed: -1,
                            prioritize_first_last_pieces: false,
                            seed_mode: false,
                            super_seeding: false,
                        },
                    },
                ],
            ],
            id: 2,
        }),
    });

    const data: any = await res.json();
    return data.result;
}

async function searchEnMovie({ name, year }) {
    const nameParam = name.replace(' ', '+');
    const strYear = String(year);

    let res: any = await (
        await fetch(
            `https://www.yts-official.to/ajax/search?query=${nameParam}`
        )
    ).json();

    const movie = res?.data?.find((m) => m?.year === strYear);
    if (!movie?.url) return;

    res = await (await fetch(movie.url)).text();
    const found = res.match(
        /<a href="(.+)"\s+class="magnet-download[ a-z\-]+"\s+title="[a-z ]+1080p/i
    );

    return found?.[1];
}

async function searchFrMovie({ name, year }) {
    const nameParam = name.replace(' ', '-');
    const strYear = String(year);

    let res = await (
        await fetch(
            `https://www5.torrent9.to/search_torrent/${nameParam}.html,trie-seeds-d`
        )
    ).text();

    const entries = [...res.matchAll(/<a title="(.+)"\s+href="(.+)"/gi)].filter(
        (e) => e[1].endsWith(strYear) && e[1].includes('1080p')
    );
    const url = entries[0]?.[2];
    if (!url) return;

    res = await (await fetch(`https://www5.torrent9.to${url}`)).text();
    const found = res.match(/"(magnet:\?xt=.+)"/i);

    return found?.[1];
}

async function searchAndDownloadMovie({ name, year, lang }) {
    const magnet =
        lang === 'en'
            ? await searchEnMovie({ name, year })
            : await searchFrMovie({ name, year });
    if (!magnet) return;
    return (await delugeAddMagnet(magnet)) ?? false;
}

async function getTvShowMagnetsElements({ name }) {
    const res = await (
        await fetch(
            `https://eztv.wf/search/?q1=${name.replace(
                ' ',
                '+'
            )}&search=Search`,
            { headers: { Cookie: 'layout=def_wlinks' } }
        )
    ).text();

    const $ = cheerio.load(res);
    return { elements: $('.magnet'), $ };
}

async function searchTvShow({ name, season, episode }) {
    const { elements, $ } = await getTvShowMagnetsElements({ name });
    const titles = [];
    elements.each((i, e) => {
        const title = $(e)
            .attr('title')
            .toLowerCase()
            .replace(' magnet link', '');
        if (
            (title.includes('1080p') || title.includes('720p')) &&
            (!season ||
                title.includes('s' + (season < 10 ? '0' : '') + season)) &&
            (!episode ||
                title.includes('e' + (episode < 10 ? '0' : '') + episode))
        ) {
            titles.push(title);
        }
    });
    return titles.reverse();
}

async function downloadTvShows({ name, keys }) {
    const { elements, $ } = await getTvShowMagnetsElements({ name });
    const magnets = [];
    elements.each((i, e) => {
        const title = $(e)
            .attr('title')
            .toLowerCase()
            .replace(' magnet link', '');
        if (keys.some((e) => title.includes(e)))
            magnets.push($(e).attr('href'));
    });

    return Promise.allSettled(magnets.map((e) => delugeAddMagnet(e)));
}

// TODO for better search create additional tools 'search-movie-torrent-urls' to return list of movies name + url to give to 'download-torrent-magnet' (magnet)

const tools: Tools = {
    'download-movie-torrent': {
        description:
            'Search and download torrent by most common english name and the year based on user choice language',
        inputSchema: {
            name: z.string(),
            year: z.number(),
            lang: z.enum(['en', 'fr']),
        },
        exec: async ({ name, year, lang }) => {
            const res = await searchAndDownloadMovie({ name, year, lang });
            return res ? 'Movie is downloading' : 'Movie not found';
        },
    },
    'search-tvshow-torrent': {
        description: 'Search tv show torrent for download',
        inputSchema: {
            name: z.string(),
            season: z.optional(z.number()),
            episode: z.optional(z.number()),
        },
        exec: async ({ name, season, episode }) => {
            const titles = await searchTvShow({ name, season, episode });
            return `Avoid duplicate and chose best among the list: ${titles
                .map((e) => '- ' + e)
                .join('\n')}`;
        },
    },
    'download-tvshow-torrent': {
        description:
            'Download tv show torrent by keys retrieved from search-tvshow-torrent ',
        inputSchema: {
            tvshowname: z.string(),
            keys: z.array(z.string()),
        },
        exec: async ({ tvshowname, keys }) => {
            await downloadTvShows({ name: tvshowname, keys });
            return `Tv show is downloading`;
        },
    },
};

export default tools;
