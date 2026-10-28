@echo off
setlocal
set "NODE_EXE=node"
if exist "D:\nodejs\node.exe" set "NODE_EXE=D:\nodejs\node.exe"
if not defined PYTHON set "PYTHON=python"
"%NODE_EXE%" "%~dp0verify.mjs" %*
exit /b %ERRORLEVEL%
