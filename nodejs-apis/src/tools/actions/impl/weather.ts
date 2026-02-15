import { Tools } from '../../../types';
import { t } from '../langs';

interface WeatherRequest {
    freeText: string;
    slots?: {
        text: string;
    };
}

async function getWeather(q: string): Promise<string | null> {
    const resLatLon = await (
        await fetch(
            `https://nominatim.openstreetmap.org/search?q=${q}&format=json&addressdetails=1&limit=1`
        )
    ).json();

    //console.log('WEATHER', resLatLon);

    const { lat, lon, address } = resLatLon?.[0] ?? {};
    if (!lat || !lon) {
        return null;
    }

    //console.log('WEATHER', lat, lon);
    const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,wind_speed_10m`
    );
    const data = await response.json();
    //console.log('WEATHER', data);

    try {
        return t('weather.answer', {
            town: address.town ?? address.city ?? address.county,
            country: address.country,
            temp: data.current.temperature_2m,
            rain: data.current.precipitation,
            windspeed: data.current.wind_speed_10m,
        });
    } catch (e) {
        console.log(e);
    }
}

export const tools: Tools = {
    weather: {
        exec: async (req: WeatherRequest) => getWeather(req.slots.text),
    },
};

export default tools;
