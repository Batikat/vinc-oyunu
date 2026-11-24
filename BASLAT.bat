@echo off
title Vinc Oyunu
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun. & pause & exit /b)
start "" http://localhost:8080
node server.js
pause
