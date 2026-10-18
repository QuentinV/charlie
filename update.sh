# restart service
docker compose stop
docker compose up -d homeassistant
docker compose up --remove-orphans -d api asr network-scanner tts llm voiceprofiler
docker compose up --build -d  frontend