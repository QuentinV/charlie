import { z } from 'zod';
import { Tools } from '../../../types';

const tools: Tools = {
    'fetch-weather': {
        description: 'Get weather data for a latitude and longitude',
        inputSchema: { latitude: z.number(), longitude: z.number() },
        exec: async ({ latitude, longitude }) => {
            const response = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m`
            );
            const data = await response.json();
            return `${data?.current?.temperature_2m}°C`;
        },
    },
};

export default tools;
