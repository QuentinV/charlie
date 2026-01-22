const { conf, apiUrl } = require('./shared');

module.exports = function (RED) {
    function MyNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        conf.provider.charlieHost = conf.charlieHost;
        conf.provider.apiPort = conf.apiPort;
        conf.provider.mqttPort = conf.mqttPort;

        (async () => {
            if (!config.host) return;
            try {
                const res = await fetch(`${apiUrl()}/api/providers`, {
                    method: 'POST',
                    body: JSON.stringify({
                        _id,
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
