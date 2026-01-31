import { z } from 'zod';

const listMessageTool = server.tool(
    'listMessages',
    { channel: z.string() },
    async ({ channel }) => ({
        content: [{ type: 'text', text: await listMessages(channel) }],
    })
);

const putMessageTool = server.tool(
    'putMessage',
    { channel: z.string(), message: z.string() },
    async ({ channel, message }) => ({
        content: [{ type: 'text', text: await putMessage(channel, message) }],
    })
);
// Until we upgrade auth, `putMessage` is disabled (won't show up in listTools)
putMessageTool.disable();

const upgradeAuthTool = server.tool(
    'upgradeAuth',
    { permission: z.enum(['write', 'admin']) },
    // Any mutations here will automatically emit `listChanged` notifications
    async ({ permission }) => {
        const { ok, err, previous } = await upgradeAuthAndStoreToken(
            permission
        );
        if (!ok) return { content: [{ type: 'text', text: `Error: ${err}` }] };

        // If we previously had read-only access, 'putMessage' is now available
        if (previous === 'read') {
            putMessageTool.enable();
        }

        if (permission === 'write') {
            // If we've just upgraded to 'write' permissions, we can still call 'upgradeAuth'
            // but can only upgrade to 'admin'.
            upgradeAuthTool.update({
                paramsSchema: { permission: z.enum(['admin']) }, // change validation rules
            });
        } else {
            // If we're now an admin, we no longer have anywhere to upgrade to, so fully remove that tool
            upgradeAuthTool.remove();
        }
    }
);

/*
Improving Network Efficiency with Notification Debouncing
When performing bulk updates that trigger notifications (e.g., enabling or disabling multiple tools in a loop), the SDK can send a large number of messages in a short period. To improve performance and reduce network traffic, you can enable notification debouncing.

This feature coalesces multiple, rapid calls for the same notification type into a single message. For example, if you disable five tools in a row, only one notifications/tools/list_changed message will be sent instead of five.

[!IMPORTANT] This feature is designed for "simple" notifications that do not carry unique data in their parameters. To prevent silent data loss, debouncing is automatically bypassed for any notification that contains a params object or a relatedRequestId. Such notifications will always be sent immediately.
*/
