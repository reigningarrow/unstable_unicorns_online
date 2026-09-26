@echo off
echo 🦄 Setting up Unstable Unicorns Online...

echo.
echo Installing server dependencies...
cd server
call npm install
if %errorlevel% neq 0 (echo ERROR: npm install failed in server/ & exit /b 1)

echo.
echo Installing client dependencies...
cd ..\client
call npm install
if %errorlevel% neq 0 (echo ERROR: npm install failed in client/ & exit /b 1)

echo.
echo Building client...
call npm run build
if %errorlevel% neq 0 (echo ERROR: Build failed & exit /b 1)

echo.
echo ✅ Setup complete!
echo.
echo To start the server:
echo   cd server
echo   node index.js
echo.
echo Then open http://localhost:3001 in your browser.
pause
