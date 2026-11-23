@echo off
chcp 65001 >nul
title Turnero Clinica - Servidor Local
cd /d "%~dp0"

set "NODE_DIR=%LOCALAPPDATA%\Programs\nodejs"
if exist "%NODE_DIR%\node.exe" set "PATH=%NODE_DIR%;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] No se encontro Node.js en esta computadora.
  echo Verifica que exista la carpeta: %NODE_DIR%
  pause
  exit /b 1
)

echo ============================================================
echo   INICIANDO TURNERO DE LA CLINICA...
echo ============================================================
echo.
echo   Panel de Administracion:  http://localhost:3000/admin
echo   Bot para Pacientes:       http://localhost:3000/bot
echo   Turnero Web:              http://localhost:3000/
echo.
echo   Deja esta ventana abierta mientras uses el turnero.
echo   Para apagarlo, simplemente cerra esta ventana.
echo ============================================================
echo.

:: Verificar si ya esta encendido en el puerto 3000
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:3000/api/status | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo [OK] El turnero ya estaba encendido. Abriendo el panel en tu navegador...
  start http://localhost:3000/admin
  timeout /t 3 /nobreak >nul
  exit /b 0
)

:: Abrir el navegador automaticamente despues de 2 segundos
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000/admin"

node src/server.js

echo.
echo El servidor se detuvo. Presiona una tecla para cerrar...
pause >nul
