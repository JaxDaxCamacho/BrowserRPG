@echo off
rem Double-click to open the Allerya Heroes tools: the content editor (gear, abilities, monsters,
rem classes, races, mercs, portraits, obstacles) and the dungeon maker. Runs on the development
rem server, which saves your edits straight into the project. Close the window to stop it.
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\play.ps1" -Tools
