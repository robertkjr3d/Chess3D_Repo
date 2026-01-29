@echo off
REM Wrapper to run frontend backup script from repo root
SET SCRIPT_DIR=%~dp0
node "%SCRIPT_DIR%frontend\scripts\backup.js" %*
