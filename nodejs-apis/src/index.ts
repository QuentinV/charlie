import 'dotenv/config';
import { initAll } from './init';
import express from 'express';
import fs from 'fs';
import https from 'https';
import cors from 'cors';
import managerApis from './manager';
import { getProvidersRestApis } from './devices';
import { buildMcpServer } from './mcp/sse_server';
import { HttpError } from './errors';
import swaggerUi from 'swagger-ui-express';
import { defaultApiPath, getSwaggerDoc } from './swagger';
import { registerNotificationApi } from './core/notifications';
import { setupEchoListen } from './echo/listen';
import { setupEchoReceiver } from './echo/receive';

const app = express();

(async () => {
    await initAll();

    const swaggerDoc = await getSwaggerDoc();
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));

    app.use(express.json());
    app.use(
        cors({
            origin: '*',
            exposedHeaders: ['Mcp-Session-Id'],
            allowedHeaders: ['Content-Type', 'mcp-session-id'],
        })
    );

    // init endpoints
    const apis = { ...managerApis, ...(await getProvidersRestApis()) };
    Object.entries(apis).forEach(([path, fullapi]) => {
        const builtPath = `${defaultApiPath}${path}`;
        Object.entries(fullapi).forEach(([methodName, endpoint]) => {
            (app as any)[methodName](builtPath, async (req: any, res: any) => {
                try {
                    if (endpoint?.fullHandler) {
                        await endpoint.fullHandler(req, res);
                    } else if (endpoint?.handler || endpoint) {
                        const result = await (endpoint?.handler ?? endpoint)(
                            req
                        );
                        result ? res.send(result) : res.sendStatus(204);
                    }
                } catch (e) {
                    if (e instanceof HttpError) {
                        res.send(e.httpStatus, e.message);
                        return;
                    }
                    res.sendStatus(500);
                }
            });
            console.log(`[API] ${methodName.toUpperCase()}`, builtPath);
        });
    });

    registerNotificationApi(app);

    // Error handler
    app.use((err: any, req: any, res: any, next: any) => {
        console.error(err.stack);
        res.status(500).json({ message: 'Something went wrong!' });
    });

    await buildMcpServer(app);

    // Start the Express server
    const port = 9300;
    let hserver = null;
    try {
        const privateKey = fs.readFileSync(
            '../invData/invDataService/certs/live/mymovies.freeboxos.fr/privkey.pem'
        );
        const certificate = fs.readFileSync(
            '../invData/invDataService/certs/live/mymovies.freeboxos.fr/fullchain.pem'
        );

        hserver = https.createServer(
            { key: privateKey, cert: certificate },
            app
        );
        hserver.listen(port, () => {
            console.log(`Https server listening on port ${port}`);
        });
    } catch (e) {
        hserver = app.listen(port, () => {
            console.log(`Http server listening on port ${port}`);
            console.log(
                `Swagger available here: http://localhost:${port}/api-docs`
            );
        });
    }

    if ( process.env.ECHO_LISTEN === 'true') {
        setupEchoListen();
    }

    if ( process.env.ECHO_RECEIVE === 'true' ) {
        setupEchoReceiver();
    }
})();
