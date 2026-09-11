import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'


// Runs a command as a per-user login service: starts it at login and restarts it after a crash.
// Windows: Task Scheduler task. macOS: launchd agent. Linux: systemd user unit.
// install() also starts it, uninstall() also stops it.
export class LoginService {
  #service

  constructor({ name, command }) {
    if (process.platform === 'win32')       this.#service = new TaskScheduler({ name, command })
    else if (process.platform === 'darwin') this.#service = new LaunchAgent({ name, command })
    else                                    this.#service = new SystemdUnit({ name, command })
  }

  install()   { return this.#service.install() }
  uninstall() { return this.#service.uninstall() }
}


// execFile, but a failure reports the tool's stderr instead of the command line
async function exec(file, args) {
  try { return await promisify(execFile)(file, args, { windowsHide: true }) }
  catch (err) { throw new Error(err.stderr?.trim() || err.message) }
}


class TaskScheduler {
  static #SYSTEM32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
  #name; #command
  constructor({ name, command }) { this.#name = name; this.#command = command }

  // Without admin rights only an interactive task can be registered, and that would open a console
  // window — `conhost --headless` runs the command without one. conhost hides the exit code, so a
  // minutely trigger restarts the process if it died (IgnoreNew: no-op while it runs). Started by
  // the scheduler, the process is outside any terminal's job object, so closing a terminal can't
  // kill it. The default settings would skip starting on battery and stop the task after 72h.
  async install() {
    const q = s => s.replace(/'/g, "''")
    const conhost = path.join(TaskScheduler.#SYSTEM32, 'conhost.exe')
    await this.#ps(`
      $user      = "$env:USERDOMAIN\\$env:USERNAME"
      $action    = New-ScheduledTaskAction -Execute '${q(conhost)}' -Argument '--headless ${this.#command.map(s => `"${q(s)}"`).join(' ')}'
      $logon     = New-ScheduledTaskTrigger -AtLogOn -User $user
      $revive    = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)
      $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
      $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
      $null = Register-ScheduledTask -TaskName '${this.#name}' -Action $action -Trigger $logon, $revive -Principal $principal -Settings $settings -Force
      Start-ScheduledTask -TaskName '${this.#name}'
    `)
  }
  uninstall() { return this.#ps(`Unregister-ScheduledTask -TaskName '${this.#name}' -Confirm:$false -ErrorAction SilentlyContinue`) }

  #ps(script) {
    const powershell = path.join(TaskScheduler.#SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe') // ships with every Windows, unlike pwsh
    // Print errors ourselves (PowerShell would wrap stderr in CLIXML) and end with exit 0 so a
    // silenced command, like uninstalling a missing task, can't fail the script
    const wrapped = `$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'\ntry {${script}} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }\nexit 0`
    const encoded = Buffer.from(wrapped, 'utf16le').toString('base64')
    return exec(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded])
  }
}


class LaunchAgent { // @macOS
  #name; #command; #plist
  #domain = `gui/${process.getuid()}`
  constructor({ name, command }) {
    this.#name    = name
    this.#command = command
    this.#plist   = path.join(os.homedir(), 'Library', 'LaunchAgents', `${name}.plist`)
  }

  // RunAtLoad starts it right away; KeepAlive restarts it only after a crash, so a clean exit stays stopped
  async install() {
    fs.mkdirSync(path.dirname(this.#plist), { recursive: true })
    fs.writeFileSync(this.#plist, `
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${this.#name}</string>
  <key>ProgramArguments</key><array>${this.#command.map(s => `<string>${s}</string>`).join('')}</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
</dict>
</plist>
`.trim())
    await exec('launchctl', ['bootout', this.#domain, this.#plist]).catch(() => {}) // not loaded yet is fine
    await exec('launchctl', ['bootstrap', this.#domain, this.#plist])
  }
  async uninstall() {
    await exec('launchctl', ['bootout', this.#domain, this.#plist]).catch(() => {})
    fs.rmSync(this.#plist, { force: true })
  }
}


class SystemdUnit { // @linux
  #name; #command; #unit
  constructor({ name, command }) {
    this.#name    = name
    this.#command = command
    this.#unit    = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'systemd', 'user', `${name}.service`)
  }

  async install() {
    fs.mkdirSync(path.dirname(this.#unit), { recursive: true })
    fs.writeFileSync(this.#unit, `
[Unit]
Description=${this.#name}

[Service]
ExecStart=${this.#command.map(s => `"${s}"`).join(' ')}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`.trim())
    await exec('systemctl', ['--user', 'daemon-reload'])
    await exec('systemctl', ['--user', 'enable', '--now', this.#name])
  }
  async uninstall() {
    await exec('systemctl', ['--user', 'disable', '--now', this.#name]).catch(() => {})
    fs.rmSync(this.#unit, { force: true })
    await exec('systemctl', ['--user', 'daemon-reload']).catch(() => {})
  }
}
