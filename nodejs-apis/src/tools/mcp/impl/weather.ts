import { z } from 'zod';
import { Tools } from '../../../types';
import { fetchCurrent } from '../../../weather/service';

const tools: Tools = {
    'fetch-weather': {
        description: 'Get weather data for a latitude and longitude',
        inputSchema: { latitude: z.number(), longitude: z.number() },
        exec: async ({ latitude, longitude }) => {
            const reading = await fetchCurrent(latitude, longitude);
            if (!reading) return 'Météo indisponible.';
            // Same vocabulary as the device and the spoken answer.
            return (
                `${reading.temperature}°C (ressenti ${reading.apparentTemperature}°C), ` +
                `${reading.condition}, humidité ${reading.humidity}%, ` +
                `vent ${reading.windSpeed} km/h ${reading.windDirection}.`
            );
        },
    },
};

export default tools;
