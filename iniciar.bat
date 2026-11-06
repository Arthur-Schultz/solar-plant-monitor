@echo off
title Solar Plant Monitor
cd /d "%~dp0"
where node >/dev/null 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e rode de novo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias, isso leva 1 ou 2 minutos...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Abrindo http://localhost:5173 ...
call npm run dev -- --open
pause
