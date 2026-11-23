@echo off
chcp 65001 >nul
title Turnero Clinica + Link Publico para Celular
cd /d "%~dp0"

set "NODE_DIR=%LOCALAPPDATA%\Programs\nodejs"
set "CF_EXE=%LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe"
if exist "%NODE_DIR%\node.exe" set "PATH=%NODE_DIR%;%PATH%"

if not exist "%CF_EXE%" (
  echo [ERROR] No se encontro cloudflared en: %CF_EXE%
  echo Podes usar INICIAR_TURNERO.bat para abrirlo en modo local.
  pause
  exit /b 1
)

echo ============================================================
echo   INICIANDO TURNERO + LINK PUBLICO PARA CELULAR
echo ============================================================
echo.
echo   1) Se abrira una ventana con el servidor del Turnero.
echo   2) Abajo aparecera un link: https://....trycloudflare.com
echo      - Para pacientes (solo Bot): agrega /bot al final
echo      - Para administracion:       agrega /admin al final
echo.
echo   Deja ambas ventanas abiertas mientras lo uses.
echo ============================================================
echo.

:: Verificar si el servidor ya esta corriendo en el puerto 3000
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:3000/api/status | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "Turnero Clinica - Servidor" cmd /k "cd /d ""%~dp0"" && set ""PATH=%NODE_DIR%;%PATH%"" && node src/server.js"
  timeout /t 3 /nobreak >nul
) else (
  echo [OK] El servidor del Turnero ya estaba encendido en el puerto 3000.
)

echo Generando link seguro HTTPS para abrir desde el celular...
echo.
"%CF_EXE%" tunnel --url http://localhost:3000 --no-autoupdate

pause
