@echo off
echo === Showing Rasa service logs ===

REM Move to project root
cd ..

REM Follow logs from the rasa service
docker compose logs -f rasa

REM Return to rasa folder after exiting logs
cd rasa
