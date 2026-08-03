@echo off
title Sunucu Baslatici (Frontend + Backend)
cd /d "%~dp0"

echo Bagimsiz Frontend ve Backend sunuculari tetikleniyor...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sunucu_baslat.ps1"
pause
