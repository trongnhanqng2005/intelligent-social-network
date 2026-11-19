$ErrorActionPreference = 'Stop'

$sourcePath = Join-Path $PSScriptRoot 'acceptance.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
$functionAst = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-Launcher'
}, $true)
if ($null -eq $functionAst) { throw 'Invoke-Launcher was not found.' }
. ([scriptblock]::Create($functionAst.Extent.Text))

$script:Image = 'sha256:selected-image'
$script:commands = [System.Collections.Generic.List[object]]::new()
$script:root = [IO.Path]::GetTempPath()
$script:invocationId = 'offline-test'
$script:env = @{ WINDIR = 'C:\Windows' }
$script:capturedArguments = $null
function Invoke-ChildProcess {
    param($Name, $FileName, $Arguments, $Environment, $ContainerCommandId)
    $script:capturedArguments = @($Arguments)
    return $null
}

foreach ($command in @(
    @{ name = 'doctor'; args = @('doctor') },
    @{ name = 'run'; args = @('run') },
    @{ name = 'tests'; args = @('test-unit') },
    @{ name = 'prepare'; args = @('prepare-source') },
    @{ name = 'negative'; args = @('doctor'); environment = @{ DOCKER_HOST = 'tcp://127.0.0.1:1' } }
)) {
    $parameters = @{ Name = $command.name; LauncherArguments = $command.args }
    if ($command.environment) { $parameters.Environment = $command.environment }
    Invoke-Launcher @parameters | Out-Null
    $imageIndex = [array]::IndexOf($script:capturedArguments, '-Image')
    if ($imageIndex -lt 0 -or $script:capturedArguments[$imageIndex + 1] -ne $script:Image) {
        throw "Launcher child '$($command.name)' did not receive selected image '$script:Image'."
    }
}
Write-Output 'ACCEPTANCE_LAUNCHER_IMAGE_TEST=PASS (5 launcher categories)'
