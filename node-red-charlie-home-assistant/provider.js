const { conf, apiUrl } = require('./shared');
const http = require('http');
const https = require('https');

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
                const targetUrl = new URL(`${apiUrl()}/api/providers`);
                const postData = JSON.stringify({
                    _id: config.providerId,
                    name: config.name,
                    codesource: 'default_custom',
                });

                const options = {
                    hostname: targetUrl.hostname,
                    port:
                        targetUrl.port ||
                        (targetUrl.protocol === 'https:' ? 443 : 80),
                    path: targetUrl.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData),
                    },
                };

                const lib = targetUrl.protocol === 'https:' ? https : http;

                const json = await new Promise((resolve, reject) => {
                    const req = lib.request(options, (res) => {
                        let data = '';
                        res.on('data', (chunk) => (data += chunk));
                        res.on('end', () => {
                            try {
                                resolve(JSON.parse(data));
                            } catch (err) {
                                reject(err);
                            }
                        });
                    });

                    req.on('error', reject);
                    req.write(postData);
                    req.end();
                });

                conf.provider.id = json.uuid;
                conf.ready = true;
            } catch (e) {
                node.warn('Charlie provider server host not configured');
            }
        })();
    }

    RED.nodes.registerType('charlie-provider', MyNode);
};
