const { conf, apiUrl } = require('./shared');

module.exports = function (RED) {
    function MyNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        conf.provider.charlieHost = config.charlieHost;
        conf.provider.apiPort = config.apiPort;
        conf.provider.mqttPort = config.mqttPort;

        (async () => {
            if (!conf?.provider?.charlieHost) return;
            try {
                const res = await fetch(`${apiUrl()}/api/providers`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        _id: config.providerId,
                        name: config.name,
                        codesource: 'default_custom',
                    }),
                });

                const json = await res.json();

                conf.provider.id = json.uuid;

                conf.ready = true;
            } catch (e) {
                node.warn('Charlie provider server host not configured');
            }
        })();
    }

    RED.nodes.registerType('charlie-provider', MyNode);
};
