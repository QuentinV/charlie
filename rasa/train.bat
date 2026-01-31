@echo off
echo === Training Rasa model ===

REM Move to project root (one level up)
cd ..

REM Run training inside Docker container
docker compose run --rm rasa train

REM Return to rasa folder
cd rasa

echo === Training complete ===
pause