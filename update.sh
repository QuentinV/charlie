# restart service
docker compose stop
docker compose up -d homeassistant
docker compose up --build -d asr api frontend
docker compose up --remove-orphans -d network-scanner tts llm voiceprofiler