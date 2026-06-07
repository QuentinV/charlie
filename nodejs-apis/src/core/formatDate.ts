const timeZone = process.env.TZ ?? 'Europe/Paris';

export function formatDateTime(date: Date) {
    return date?.toLocaleTimeString(undefined, { timeZone });
}

export function formatDate(date: Date) {
    return date?.toLocaleDateString(undefined, { timeZone });
}
