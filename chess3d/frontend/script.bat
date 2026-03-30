ren build\static static2
ren build\index.html index_3.html

@echo off
set "file=build\index_3.html"
set "find=static"
set "replace=static2"

powershell -Command "(Get-Content '%file%') -replace '%find%', '%replace%' | Set-Content '%file%'"