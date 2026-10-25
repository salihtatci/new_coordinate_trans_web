@echo off
setlocal
cd /d "%~dp0"
set "PYTHONUTF8=1"
if not exist ".venv\Scripts\python.exe" (
  echo Once KURULUM.bat ile kurulum yapin.
  pause
  exit /b 1
)
set "HATA=0"
echo ===== Hesap cekirdegi testleri (test_jeodezi.py) =====
".venv\Scripts\python.exe" test_jeodezi.py
if errorlevel 1 set "HATA=1"
echo.
echo ===== Arayuz testleri (test_arayuz.py) =====
".venv\Scripts\python.exe" test_arayuz.py
if errorlevel 1 set "HATA=1"
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi: web sitesi testleri atlandi.
) else (
  echo ===== Web sitesi testleri (Node.js) =====
  node web_tests\test_jeodezi_js.js
  if errorlevel 1 set "HATA=1"
  node web_tests\test_geoit_js.js
  if errorlevel 1 set "HATA=1"
  node icgem-proxy\test_worker.mjs
  if errorlevel 1 set "HATA=1"
)
echo.
if "%HATA%"=="0" (
  echo Tum testler gecti.
) else (
  echo En az bir test BASARISIZ. Yukaridaki ciktiyi inceleyin.
)
pause
