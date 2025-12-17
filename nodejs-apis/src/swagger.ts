import managerApis from './manager';
import { getProvidersRestApis } from './devices';

export const defaultApiPath = '/api/';

export async function getSwaggerDoc() {
    const apis = { ...managerApis, ...(await getProvidersRestApis()) };

    const swaggerDoc = {
        openapi: '3.0.0',
        info: {
            title: 'Charlie API',
            version: '1.0.0',
            description:
                'Full api to control devices, rooms, or other charlie features',
        },
        servers: [
            {
                url: `http://localhost:9300`,
            },
        ],
        paths: {},
    };

    const extractParams = (route) => {
        const regex = /:([a-zA-Z0-9_]+)/g;
        const params = [];
        let match;
        while ((match = regex.exec(route)) !== null) {
            params.push(match[1]);
        }
        return params;
    };

    Object.entries(apis).forEach(([path, fullapi]) => {
        const paths: any = swaggerDoc.paths;
        const pathParams = extractParams(path);
        pathParams.forEach((p) => (path = path.replace(`:${p}`, `{${p}}`)));

        const firstSlash = path.indexOf('/');
        let tag = path.substring(
            0,
            firstSlash !== -1 ? firstSlash : path.length
        );
        tag = tag[0].toUpperCase() + tag.substring(1);

        const builtPath = `${defaultApiPath}${path}`;
        Object.entries(fullapi).forEach(([methodName, endpoint]) => {
            if (!paths[builtPath]) paths[builtPath] = {};

            (paths[builtPath] as any)[methodName] = {
                summary: endpoint?.description ?? '',
                responses: {
                    '200': {
                        description: 'Successful response',
                    },
                },
                requestBody:
                    methodName !== 'get'
                        ? {
                              content: {
                                  ['application/json']: {
                                      schema: { type: 'object' },
                                  },
                              },
                          }
                        : undefined,
                tags: [tag],
                parameters: [
                    ...pathParams.map((name) => ({
                        name,
                        in: 'path',
                        required: true,
                        schema: {
                            type: 'string',
                        },
                    })),
                    ...Object.entries(endpoint.querySchema ?? {}).map(
                        ([k, { type, required }]: [string, any]) => ({
                            name: k,
                            in: 'query',
                            required: required ?? true,
                            schema: {
                                type,
                            },
                        })
                    ),
                ],
            };
        });
    });

    return swaggerDoc;
}
