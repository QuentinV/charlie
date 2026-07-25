const conf = {
    provider: {
        id: undefined,
        host: undefined,
    },
    ready: false,
};

module.exports = {
    conf,
    apiUrl: () =>
        `http://${conf.provider.charlieHost ?? 'localhost'}:${conf.provider.apiPort ?? '9300'}`,
    mqttHost: () =>
        `mqtt://${conf.provider.charlieHost}:${conf.provider.mqttPort ?? '9304'}`,
    isReady: () => {
        return new Promise((res) => {
            const inter = setInterval(() => {
                if (conf.ready) {
                    clearInterval(inter);
                    res();
                }
            }, 500);
        });
    },
};
