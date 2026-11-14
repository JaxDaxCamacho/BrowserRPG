@echo off
rem Double-click to run the game on the development server: code changes show up live.
rem Slower to load than Play.bat. The editors are in Tools.bat.
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\play.ps1" -Dev
