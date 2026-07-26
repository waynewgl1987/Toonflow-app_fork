$env:CI="true"
$env:GIT_TERMINAL_PROMPT="0"
$env:GCM_INTERACTIVE="never"
$env:HOMEBREW_NO_AUTO_UPDATE="1"
$env:GIT_EDITOR=":"
$env:EDITOR=":"
$env:VISUAL=""
$env:GIT_SEQUENCE_EDITOR=":"
$env:GIT_MERGE_AUTOEDIT="no"
$env:GIT_PAGER="cat"
$env:PAGER="cat"
$env:npm_config_yes="true"

Set-Location "E:\AI\Toonflow-app"
git add -A
git commit -m "fix: server hanging due to esbuild event loop stall + logger rotation blocking"
git push origin master
Write-Host "Done!"
