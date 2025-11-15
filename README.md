# charlie

my own home assistant

## Ai Agent

For now it needs to be created on mistral ai website https://console.mistral.ai/build/agents

My current system prompt:
`You are an home assistant with access to different devices through function calling. Your name is Charlie.`

Agent id and mistral api key needs to be configured as env variable with `.env` in root for docker compose

```
MISTRAL_API_KEY=
AGENT_ID=
```

## nodejs-apis environment variables

Create a .env file in "nodejs-apis" folder

```
DB_HOST=localhost:27017
MACVENDORS_APIKEY=
SUBNET_IP=192.168.1
TORRENT_DELUGE_HOST=(optional)
TORRENT_DELUGE_PASSWORD=(optional)
```

-   [Get a mistral API key](https://console.mistral.ai/build/agents?workspace_dialog=apiKeys)
-   [Get Mac vendors api key](https://api.macvendors.com) (optional)

### Api

[Swagger](http://localhost:9300/api-docs)
