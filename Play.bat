@echo off
rem Double-click to play Allerya Heroes.
rem Starts the game server inside WSL and opens it in your browser.
rem Close this window to stop the game.

title Allerya Heroes
set "URL=http://127.0.0.1:5173"

rem Already running? Just open it again.
powershell -NoProfile -Command "try { Invoke-WebRequest '%URL%' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  start "" "%URL%"
  exit /b 0
)

rem Open the browser as soon as the server answers (gives up after two minutes).
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 240; $i++) { try { Invoke-WebRequest '%URL%' -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process '%URL%'; break } catch { Start-Sleep -Milliseconds 500 } }"

echo Starting Allerya Heroes... your browser will open when it is ready.
echo Close this window to stop the game.
echo.

rem Bound to 127.0.0.1 (IPv4) so Windows can reach it through WSL; it stays private to this PC.
rem The trailing "." keeps the folder's final backslash from escaping the quote.
wsl.exe --cd "%~dp0." bash -lc "if [ ! -d node_modules ]; then echo 'First run: installing packages...'; npm install || exit 1; fi; npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"

if errorlevel 1 (
  echo.
  echo The game stopped with an error. See the messages above.
  pause
)
