@echo off
rem Double-click to play Allerya Heroes.
rem The game opens in its own window; the server runs hidden in the background
rem and stops when you close the game window. Problems show in a message box.
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\play.ps1"
