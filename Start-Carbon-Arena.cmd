@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer before starting Carbon Arena.
  pause
  exit /b 1
)
if not exist "duel\node_modules\quickjs-emscripten" (
  echo Run npm ci in this folder once before starting Carbon Arena.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:4327 in your browser.
node competition/server.cjs --port 4327
pause
