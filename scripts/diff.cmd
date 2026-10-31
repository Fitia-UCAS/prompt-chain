@echo off
rem ---------------------------------------------------------------
rem  Windows wrapper for diff.sh (same folder)
rem  Prefers Git Bash; falls back to the WSL bash.
rem  Usage:  scripts\diff.cmd [-o out.patch] [-r rev] [-s] [-- path...]
rem ---------------------------------------------------------------
setlocal
chcp 65001 >nul 2>&1

set "HERE=%~dp0"
set "SCRIPT=%HERE%diff.sh"
set "PF=%ProgramFiles%"
set "PF86=%ProgramFiles(x86)%"
set "LAPP=%LOCALAPPDATA%\Programs"
set "GITBASH="

rem --- 1) derive from git.exe on PATH (covers custom install dirs, e.g. D:\Git) ---
set "GITEXE="
for %%G in (git.exe) do set "GITEXE=%%~$PATH:G"
if not defined GITEXE goto known_dirs
for %%D in ("%GITEXE%") do set "GITDIR=%%~dpD"
pushd "%GITDIR%..\bin" 2>nul
if exist "%CD%\bash.exe" set "GITBASH=%CD%\bash.exe"
popd
if defined GITBASH goto run_gitbash

:known_dirs
rem --- 2) well known Git for Windows install locations ---
if exist "%PF%\Git\bin\bash.exe" set "GITBASH=%PF%\Git\bin\bash.exe"
if not defined GITBASH if exist "%PF86%\Git\bin\bash.exe" set "GITBASH=%PF86%\Git\bin\bash.exe"
if not defined GITBASH if exist "%LAPP%\Git\bin\bash.exe" set "GITBASH=%LAPP%\Git\bin\bash.exe"
if not defined GITBASH if exist "D:\Git\bin\bash.exe" set "GITBASH=D:\Git\bin\bash.exe"
if defined GITBASH goto run_gitbash

rem --- 3) bash.exe on PATH, but skip the WSL launcher in System32 ---
for %%B in (bash.exe) do set "PATHBASH=%%~$PATH:B"
if not defined PATHBASH goto try_wsl
echo %PATHBASH% | findstr /i /c:"\Windows\System32\bash.exe" >nul
if not errorlevel 1 goto try_wsl
set "GITBASH=%PATHBASH%"
goto run_gitbash

:run_gitbash
"%GITBASH%" "%SCRIPT%" %*
exit /b %errorlevel%

:try_wsl
where wsl.exe >nul 2>&1
if errorlevel 1 goto no_bash
wsl.exe --cd "%HERE%" bash -lc "bash ./diff.sh %*"
exit /b %errorlevel%

:no_bash
echo [diff] bash not found. Install Git for Windows (ships Git Bash) or enable WSL.
exit /b 1
