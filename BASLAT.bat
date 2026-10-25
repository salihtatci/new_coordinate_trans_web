@echo off
setlocal
cd /d "%~dp0"
set "PYTHONUTF8=1"
if not exist ".venv\Scripts\python.exe" (
  echo Kurulum bulunamadi. Once KURULUM.bat dosyasini calistirin.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" main.py
if errorlevel 1 (
  echo.
  echo Uygulama hata ile kapandi. Yukaridaki hata metnini kaydedin.
  echo Ortam baska bilgisayardan kopyalandiysa .venv klasorunu silip KURULUM.bat dosyasini calistirin.
  pause
)
