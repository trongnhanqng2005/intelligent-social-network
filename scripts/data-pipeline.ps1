[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('doctor', 'prepare-source', 'run', 'test-unit', 'test-integration')]
    [string]$Command,

    [string]$Source,
    [string]$Manifest,
    [string]$OutputRoot,
    [string]$Image = 'isn-b-data-pipeline:py3.12-pyspark3.5.9-runtime-snappy'
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if (-not $OutputRoot) {
    $OutputRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'datasets/pipeline-output'
}

function ConvertTo-DockerPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [System.IO.Path]::GetFullPath($Path).Replace('\', '/')
}

function Resolve-InputFile {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Name)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Name file does not exist: $Path"
    }
    return ConvertTo-DockerPath (Resolve-Path -LiteralPath $Path).Path
}

function Get-DockerBaseArguments {
    param(
        [switch]$WithInputs,
        [string]$WritableOutput
    )

    $projectRoot = ConvertTo-DockerPath (Split-Path -Parent $PSScriptRoot)
    $arguments = @(
        'run', '--rm', '--platform', 'linux/amd64', '--cpus=2', '--memory=4g',
        '--pids-limit=256', '--network', 'none', '--hostname', 'isn-etl',
        '--add-host', 'isn-etl:127.0.0.1',
        '--tmpfs', '/tmp:rw,nosuid,nodev,size=1g,mode=1777',
        '--tmpfs', '/run/isn-etl-snappy:rw,exec,nosuid,nodev,size=64m,mode=0700,uid=10001,gid=10001',
        '--mount', "type=bind,source=$projectRoot,target=/workspace,readonly",
        '--workdir', '/workspace',
         '--env', 'PYTHONPATH=/workspace/data-pipeline/src',
         '--env', 'PYSPARK_PYTHON=/opt/venv/bin/python',
         '--env', 'PYSPARK_DRIVER_PYTHON=/opt/venv/bin/python',
         '--env', 'JAVA_TOOL_OPTIONS=-Dorg.xerial.snappy.tempdir=/run/isn-etl-snappy -XX:ActiveProcessorCount=2'
    )

    if ($env:ISN_ETL_INVOCATION_ID) {
        if ($env:ISN_ETL_INVOCATION_ID -notmatch '^[A-Za-z0-9_.-]{1,80}$') {
            throw 'ISN_ETL_INVOCATION_ID contains unsupported characters.'
        }
        $arguments += @('--label', "org.weylume.isn-etl.invocation=$($env:ISN_ETL_INVOCATION_ID)")
    }
    if ($env:ISN_ETL_COMMAND_ID) {
        if ($env:ISN_ETL_COMMAND_ID -notmatch '^[A-Za-z0-9_.-]{1,80}$') {
            throw 'ISN_ETL_COMMAND_ID contains unsupported characters.'
        }
        $arguments += @('--label', "org.weylume.isn-etl.command=$($env:ISN_ETL_COMMAND_ID)")
    }
    if ($env:ISN_ETL_CONTAINER_ID_FILE) {
        $containerIdPath = [System.IO.Path]::GetFullPath($env:ISN_ETL_CONTAINER_ID_FILE)
        if (Test-Path -LiteralPath $containerIdPath) {
            throw "Refusing to overwrite an existing Docker cidfile: $containerIdPath"
        }
        $arguments += @('--cidfile', $containerIdPath)
    }

    if ($WithInputs) {
        $sourcePath = Resolve-InputFile -Path $Source -Name 'Source'
        $manifestPath = Resolve-InputFile -Path $Manifest -Name 'Manifest'
        $sourceName = [System.IO.Path]::GetFileName($sourcePath)
        if ($sourceName -eq 'manifest.json') {
            throw 'Source file basename manifest.json conflicts with the container manifest mount.'
        }
        $arguments += @(
            '--mount', "type=bind,source=$sourcePath,target=/input/$sourceName,readonly",
            '--mount', "type=bind,source=$manifestPath,target=/input/manifest.json,readonly"
        )
    }

    if ($WritableOutput) {
        $outputDockerPath = ConvertTo-DockerPath $WritableOutput
        $arguments += @('--mount', "type=bind,source=$outputDockerPath,target=/output")
    }

    $arguments += @('--entrypoint', 'python', $Image)
    return ,$arguments
}

function Invoke-Container {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & docker @Arguments
    $code = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($code -ne 0) {
        throw "Docker command failed with exit code $code"
    }
}

try {
    & docker info --format '{{.OSType}}' *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker daemon is unavailable for this child process; verify Docker Desktop and its DOCKER_HOST setting.'
    }

    & docker image inspect $Image *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Required task-owned Docker image is missing: $Image. Do not pull or rebuild it implicitly; follow data-pipeline/README.md."
    }

    switch ($Command) {
        'doctor' {
            $arguments = Get-DockerBaseArguments
            Invoke-Container -Arguments ($arguments + @('-m', 'isn_etl', 'doctor'))
        }
        'prepare-source' {
            if (-not $Source -or -not $Manifest) {
                throw 'prepare-source requires -Source and -Manifest. This command verifies supplied pins only; it never downloads or creates them.'
            }
            $arguments = Get-DockerBaseArguments -WithInputs
            $containerSource = "/input/$([System.IO.Path]::GetFileName($Source))"
            Invoke-Container -Arguments ($arguments + @('-m', 'isn_etl', 'prepare-source', '--source', $containerSource, '--manifest', '/input/manifest.json'))
        }
        'run' {
            if (-not $Source -or -not $Manifest) {
                throw 'run requires -Source and -Manifest.'
            }
            $outputPath = [System.IO.Path]::GetFullPath($OutputRoot)
            $projectPath = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\', '/')
            if ($outputPath.TrimEnd('\', '/') -eq $projectPath -or $projectPath.StartsWith($outputPath.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw 'OutputRoot cannot be the repository root or one of its ancestors.'
            }
            [System.IO.Directory]::CreateDirectory($outputPath) | Out-Null
            $arguments = Get-DockerBaseArguments -WithInputs -WritableOutput $outputPath
            $containerSource = "/input/$([System.IO.Path]::GetFileName($Source))"
            Invoke-Container -Arguments ($arguments + @('-m', 'isn_etl', 'run', '--source', $containerSource, '--manifest', '/input/manifest.json', '--output-root', '/output'))
        }
        'test-unit' {
            $arguments = Get-DockerBaseArguments
            Invoke-Container -Arguments ($arguments + @('-m', 'unittest', 'discover', '-s', 'tests/unit/data_pipeline', '-p', 'test_*.py', '-v'))
        }
        'test-integration' {
            $arguments = Get-DockerBaseArguments
            Invoke-Container -Arguments ($arguments + @('-m', 'unittest', 'discover', '-s', 'tests/integration/data_pipeline', '-p', 'test_*.py', '-v'))
        }
    }
}
catch {
    [Console]::Error.WriteLine("data-pipeline $Command failed: $($_.Exception.Message)")
    exit 2
}
