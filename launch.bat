@echo off
title BBB Design Explorer
echo.
echo  =============================================
echo    BBB Design Explorer
echo    Energy Simulation Visualization Tool
echo  =============================================
echo.

REM Python path
set PYTHON_PATH="%LOCALAPPDATA%\Programs\Python\Python314\python.exe"

REM Check for Python at known path, then fallback to PATH
if exist %PYTHON_PATH% (
    echo  Starting local server on http://localhost:8080
    echo  Press Ctrl+C to stop the server.
    echo.
    start "" "http://localhost:8080"
    %PYTHON_PATH% -m http.server 8080 --directory "%~dp0"
) else (
    where python >nul 2>&1
    if %errorlevel%==0 (
        echo  Starting local server on http://localhost:8080
        echo  Press Ctrl+C to stop the server.
        echo.
        start "" "http://localhost:8080"
        python -m http.server 8080 --directory "%~dp0"
    ) else (
        echo  Python not found - opening directly in browser.
        echo  Note: For full functionality, install Python from python.org
        echo.
        start "" "%~dp0index.html"
        echo  Application opened in your default browser.
        echo  Press any key to exit...
        pause >nul
    )
)
