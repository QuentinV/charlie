# restart service
docker compose stop
docker compose up api --build -d
docker compose up frontend --build -d
docker compose up ai-agents --build -d
docker compose up --remove-orphans -d