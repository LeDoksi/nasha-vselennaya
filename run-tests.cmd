@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Установи Node.js: https://nodejs.org
  pause
  exit /b 1
)
echo Сборка app.js из src\...
node build.js
if errorlevel 1 (
  echo Сборка не удалась — тесты не запускаю.
  pause
  exit /b 1
)
echo Запуск проверки «Нашей вселенной»...
node tests\uni-smoke.js app.js
pause
