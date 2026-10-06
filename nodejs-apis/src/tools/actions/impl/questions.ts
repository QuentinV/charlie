import { Tools } from '../../../types';
import { settings } from '../../../manager/services/settings';
import { t } from '../langs';

export const tools: Tools = {
    askTime: {
        exec: async () =>
            `Il est ${new Date().toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
            })}.`,
    },
    askDate: {
        exec: async () =>
            `Nous sommes le ${new Date().toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
            })}.`,
    },
    askWeather: {
        exec: async () => {
            const latitude = Number(settings.weather?.latitude);
            const longitude = Number(settings.weather?.longitude);
            if (!latitude || !longitude) {
                // Location not configured yet → let the caller know it is
                // not possible rather than answering something wrong.
                return false;
            }
            try {
                const response = await fetch(
                    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,rain,wind_speed_10m`
                );
                const data = await response.json();
                const current = data?.current;
                if (current?.temperature_2m === undefined) {
                    return false;
                }
                return t('weather.answer', {
                    temp: current.temperature_2m,
                    rain: current.rain ?? 0,
                    windspeed: current.wind_speed_10m ?? 0,
                });
            } catch (e) {
                return false;
            }
        },
    },
    howAreYou: {
        exec: async () => t('howAreYou.response'),
    },
    whoAreYou: {
        exec: async () => t('whoAreYou.response'),
    },
};

export default tools;