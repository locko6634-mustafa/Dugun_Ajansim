@echo off
title Python HTTP Server Baslatici
cd /d "%~dp0"

echo Bagimsiz Python sunucusu tetikleniyor...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sunucu_baslat.ps1"
pause
