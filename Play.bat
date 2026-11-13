@echo off
rem Double-click to play Allerya Heroes: fast to load, from a production build.
rem After a code change the first start rebuilds the game, which takes a little longer.
rem The game opens in its own window; closing it stops the server. Problems show in a message box.
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\play.ps1"
