import { cs } from '../core/db';
import { RestApis } from '../types';

const routes: RestApis = {
    activities: {
        get: {
            handler: async ({ query }) => {
                const { type } = query ?? {};
                const $limit = parseInt(query?.limit ?? 5);
                const $skip = parseInt(query?.first ?? 0);

                const filters: any = {};
                if (type) {
                    filters.type = type;
                }

                const aggregate: any = [
                    { $match: { $and: [filters] } },
                    { $sort: { _id: -1 } },
                    { $skip },
                    { $limit },
                ];

                return {
                    total: await cs.activities.count(filters),
                    data: await cs.activities.aggregate(aggregate).toArray(),
                };
            },
            description: 'Search activities',
            querySchema: {
                type: { type: 'string', required: false },
                limit: { type: 'number', required: false },
                first: { type: 'number', required: false },
            },
        },
    },
};

export default routes;
