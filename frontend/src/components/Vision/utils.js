import { useEffect, useState } from 'react';
import { apiBlob } from '../../api/charlie';

/**
 * Object URL of a scan image, fetched with the auth token (an `<img src>` cannot
 * carry the Authorization header). Revoked when the scan changes or the
 * component unmounts, so browsing the history never leaks blob URLs.
 */
export const useScanImage = (imageUrl) => {
    const [src, setSrc] = useState(null);

    useEffect(() => {
        let created = null;
        let cancelled = false;
        setSrc(null);

        if (!imageUrl) return undefined;
        // The API answers a path rooted at /api; `apiBlob` adds it back.
        const path = imageUrl.replace(/^\/api\//, '');

        apiBlob(path).then((url) => {
            if (cancelled) {
                if (url) URL.revokeObjectURL(url);
                return;
            }
            created = url;
            setSrc(url);
        });

        return () => {
            cancelled = true;
            if (created) URL.revokeObjectURL(created);
        };
    }, [imageUrl]);

    return src;
};

/** "il y a 5 min" / "12/11 14:32" — a compact stamp for the list rows. */
export const formatWhen = (at, lang = 'fr') => {
    if (!at) return '';
    const minutes = Math.round((Date.now() - at) / 60000);
    if (minutes < 1) return lang === 'fr' ? "à l'instant" : 'just now';
    if (minutes < 60) {
        return lang === 'fr' ? `il y a ${minutes} min` : `${minutes} min ago`;
    }
    return new Date(at).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
};

/** Seconds → "45 s" / "12 min" / "1 h 30". */
export const formatDuration = (seconds) => {
    if (!seconds) return '';
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest}` : `${hours} h`;
};

/** French label of a document type ("recipe" → "Recette"). */
export const typeLabel = (modules, type) =>
    modules?.find((m) => m.id === type)?.label ?? type ?? '';
