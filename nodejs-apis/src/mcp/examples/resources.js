import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Add a dynamic greeting resource
server.registerResource(
    'greeting',
    new ResourceTemplate('greeting://{name}', { list: undefined }),
    {
        title: 'Greeting Resource', // Display name for UI
        description: 'Dynamic greeting generator',
    },
    async (uri, { name }) => ({
        contents: [
            {
                uri: uri.href,
                text: `Hello, ${name}!`,
            },
        ],
    })
);

// Static resource
server.registerResource(
    'config',
    'config://app',
    {
        title: 'Application Config',
        description: 'Application configuration data',
        mimeType: 'text/plain',
    },
    async (uri) => ({
        contents: [
            {
                uri: uri.href,
                text: 'App configuration here',
            },
        ],
    })
);

// Dynamic resource with parameters
server.registerResource(
    'user-profile',
    new ResourceTemplate('users://{userId}/profile', { list: undefined }),
    {
        title: 'User Profile',
        description: 'User profile information',
    },
    async (uri, { userId }) => ({
        contents: [
            {
                uri: uri.href,
                text: `Profile data for user ${userId}`,
            },
        ],
    })
);

// Resource with context-aware completion
server.registerResource(
    'repository',
    new ResourceTemplate('github://repos/{owner}/{repo}', {
        list: undefined,
        complete: {
            // Provide intelligent completions based on previously resolved parameters
            repo: (value, context) => {
                if (context?.arguments?.['owner'] === 'org1') {
                    return ['project1', 'project2', 'project3'].filter((r) =>
                        r.startsWith(value)
                    );
                }
                return ['default-repo'].filter((r) => r.startsWith(value));
            },
        },
    }),
    {
        title: 'GitHub Repository',
        description: 'Repository information',
    },
    async (uri, { owner, repo }) => ({
        contents: [
            {
                uri: uri.href,
                text: `Repository: ${owner}/${repo}`,
            },
        ],
    })
);
