import express from 'express';
import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';

const app = express();

const proxyProvider = new ProxyOAuthServerProvider({
    endpoints: {
        authorizationUrl: 'https://auth.external.com/oauth2/v1/authorize',
        tokenUrl: 'https://auth.external.com/oauth2/v1/token',
        revocationUrl: 'https://auth.external.com/oauth2/v1/revoke',
    },
    verifyAccessToken: async (token) => {
        return {
            token,
            clientId: '123',
            scopes: ['openid', 'email', 'profile'],
        };
    },
    getClient: async (client_id) => {
        return {
            client_id,
            redirect_uris: ['http://localhost:3000/callback'],
        };
    },
});

app.use(
    mcpAuthRouter({
        provider: proxyProvider,
        issuerUrl: new URL('http://auth.external.com'),
        baseUrl: new URL('http://mcp.example.com'),
        serviceDocumentationUrl: new URL('https://docs.example.com/'),
    })
);
