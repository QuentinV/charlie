@echo off
echo === Cleaning Rasa project (models + results) ===

REM Remove old models and test results
rmdir /s /q "fr/models" && rmdir /s /q "fr/results"

echo === Clean complete ===
pause
