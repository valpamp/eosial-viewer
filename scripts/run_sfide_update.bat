@echo off
setlocal EnableExtensions

rem ================================================================
rem EOSIAL hotspot database updater for Windows Task Scheduler
rem
rem Recommended Task Scheduler setup:
rem   Program/script: F:\Valerio\eosial-viewer\scripts\run_sfide_update.bat
rem   Start in:       F:\Valerio\eosial-viewer
rem   Trigger:        Repeat every 30 minutes
rem ================================================================

set "REPO_ROOT=F:\Valerio\eosial-viewer"
set "SOURCE_DIR=U:\ftp\sfide\ITA"
set "FIRMS_SOURCE_DIR=X:\ftp\cufa\FIRMS_NRT\ITA\firms\fgb"
set "S3_SOURCE_DIR=X:\ftp\cufa\S3_NRT\S3_FRP_CROPS"
set "OUTPUT_DIR=%REPO_ROOT%\data\fire"
set "CONDA_HOOK=C:\ProgramData\miniconda3\shell\condabin\conda-hook.ps1"
set "CONDA_ENV=eosial-viewer"
set "LOG_DIR=%REPO_ROOT%\logs"
set "LOG_FILE=%LOG_DIR%\sfide_update.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo.
echo ================================================================
echo [%date% %time%] Starting EOSIAL hotspot database update
echo Repo:   %REPO_ROOT%
echo Source: %SOURCE_DIR%
echo FIRMS:  %FIRMS_SOURCE_DIR%
echo S3:     %S3_SOURCE_DIR%
echo Output: %OUTPUT_DIR%
echo Log:    %LOG_FILE%
echo ================================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Continue';" ^
  "$repo = '%REPO_ROOT%';" ^
  "$source = '%SOURCE_DIR%';" ^
  "$output = '%OUTPUT_DIR%';" ^
  "$hook = '%CONDA_HOOK%';" ^
  "$envPath = '%CONDA_ENV%';" ^
  "$log = '%LOG_FILE%';" ^
  "function LogLine([string]$msg) { $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $msg; $line | Tee-Object -FilePath $log -Append }" ^
  "LogLine 'Batch wrapper started.';" ^
  "LogLine ('Repository: ' + $repo);" ^
  "LogLine ('SFIDE source: ' + $source);" ^
  "$firmsSource = '%FIRMS_SOURCE_DIR%';" ^
  "$s3Source = '%S3_SOURCE_DIR%';" ^
  "LogLine ('FIRMS source: ' + $firmsSource);" ^
  "LogLine ('Sentinel-3 source: ' + $s3Source);" ^
  "LogLine ('Website output: ' + $output);" ^
  "if (-not (Test-Path -LiteralPath $repo)) { LogLine ('ERROR: repository path not found: ' + $repo); exit 10 }" ^
  "if (-not (Test-Path -LiteralPath $source)) { LogLine ('ERROR: SFIDE source path not found: ' + $source); exit 11 }" ^
  "if (-not (Test-Path -LiteralPath $hook)) { LogLine ('ERROR: conda hook not found: ' + $hook); exit 12 }" ^
  "Set-Location -LiteralPath $repo;" ^
  "LogLine 'Activating conda environment...';" ^
  "& $hook;" ^
  "conda activate $envPath;" ^
  "if ($LASTEXITCODE -ne 0) { LogLine ('ERROR: conda activation failed with exit code ' + $LASTEXITCODE); exit $LASTEXITCODE }" ^
  "LogLine 'Running combined hotspot updater...';" ^
  "python -u scripts\update_hotspot_databases.py --sfide-source-dir $source --firms-source-dir $firmsSource --s3-source-dir $s3Source --output-dir $output --output-format fgb --git --progress-interval-seconds 5 2>&1 | Tee-Object -FilePath $log -Append;" ^
  "$code = $LASTEXITCODE;" ^
  "if ($code -ne 0) { LogLine ('ERROR: combined hotspot updater failed with exit code ' + $code); exit $code }" ^
  "LogLine 'Combined hotspot updater finished successfully.'" ^
  "exit $code"

set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo [%date% %time%] Hotspot database update finished with exit code %EXIT_CODE%.
echo See log: %LOG_FILE%
echo.

exit /b %EXIT_CODE%
