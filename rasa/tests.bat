@echo off
echo === Running Rasa tests ===

REM Move to project root
cd ..

REM Run NLU + Core tests
docker compose run --rm rasa test

REM Return to rasa folder
cd rasa

echo === Tests complete ===
pause