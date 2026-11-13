@echo off
rem Double-click to work on Allerya Heroes: the development server, with the content editor
rem and dungeon maker on the main menu. Slower to load than Play.bat; changes show up live.
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\play.ps1" -Dev
