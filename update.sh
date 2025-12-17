git pull
cd nodejs-apis
yarn install
cd ..
docker compose stop
docker compose -p charlie up --remove-orphans