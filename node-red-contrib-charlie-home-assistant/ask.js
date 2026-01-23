const { conf, isReady, apiUrl, mqttHost } = require('./shared');

module.exports = function (RED) {
    function MyNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.on('input', async function (msg, send) {
            await isReady();

            const payload = msg.payload;

            let json = undefined;
            if (payload?.message) {
                try {
                    const res = await fetch(`${apiUrl()}/api/assistant/chat`, {
                        method: 'POST',
                        body: JSON.stringify({ message: payload.message }),
                    });

                    json = await res.json();
                } catch (e) {
                    node.warn('Error cannot ask assistant please retry later.');
                }
            }

            node.send([{ ...msg, payload: json }]);
        });
    }

    RED.nodes.registerType('charlie-ask', MyNode);
};
