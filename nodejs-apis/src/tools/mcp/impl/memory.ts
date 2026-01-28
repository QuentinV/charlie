/*
 store memory in db.
 Teach via prompt "What is your name?", "Where do you live?" whenever data is needed
 Should be possible to update the data later
*/

/*
server.registerTool(
    'set_memory',
    {
        title: 'Set Memory',
        description: 'Stores arbitrary memory for a user',
        inputSchema: z.object({
            userId: z.string(),
            key: z.string(),
            value: z.string(),
        }),
    },
    async ({ userId, key, value }) => {
        await saveToMemory(userId, key, value);
        return {
            content: [{ type: 'text', text: `Saved: ${key} = ${value}` }],
        };
    }
);

server.registerResourceTemplate(
    'user_memory',
    {
        title: 'User Memory',
        description: 'Returns stored memory for a user and key',
        inputSchema: z.object({
            userId: z.string(),
            key: z.string(),
        }),
    },
    async ({ userId, key }) => {
        const value = await getMemory(userId, key);
        return {
            contents: [
                {
                    uri: `memory://user/${userId}/${key}`,
                    text: `Memory for ${key}: ${value}`,
                },
            ],
        };
    }
);
*/

/*

new ResourceTemplate('memory://user/{userId}/{key}', {
  userId: undefined,
  key: { list: true }
})

if (key === undefined) {
  const allKeys = await listMemoryKeys(userId);
  return {
    contents: allKeys.map(k => ({
      uri: `memory://user/${userId}/${k}`,
      text: `Stored key: ${k}`
    }))
  };
}

*/

/*

Expiration	Add TTL to memory entries
Confidence Score	Let model rank memory reliability
Semantic Search	Retrieve memory by meaning, not just key
Memory Graph	Link related memories (e.g. goals → tasks → events)
Session Recall	Automatically preload memory into context
*/

/*
🧠 Bonus: You Can Teach the Model to Use It
You can add a system message or example like:

“You can store and retrieve user memory using URIs like memory://user/{userId}/{key}. For example, memory://user/abc123/favorite_color returns the user's favorite color.”

This primes the model to use it proactively.
*/
