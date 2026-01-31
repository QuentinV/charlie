# restart service
docker compose stop
docker compose up api --build -d
docker compose up --remove-orphans -d