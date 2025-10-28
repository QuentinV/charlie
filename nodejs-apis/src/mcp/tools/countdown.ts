/*export default {
    stream_countdown: async ({ from }, stream) => {
        for (let i = from; i >= 0; i--) {
            stream.write({ chunk: `Countdown: ${i}` });
            await new Promise((res) => setTimeout(res, 500));
        }
        stream.end({ done: true });
    },
};
*/

// TODO
