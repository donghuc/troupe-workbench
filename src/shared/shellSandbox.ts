// Shell sandbox for Claude in Auto (D-115, security review 2026-10 #5). Auto pre-approves
// Bash in headless runs, so text in a file or web page could tell the agent to run any
// command. Claude Code's own sandbox (macOS Seatbelt) confines those commands: writes only
// in the project, its added folders and a temp dir; network only to the listed sites;
// credential folders unreadable. It fails closed: no unsandboxed retry, and the run stops
// if the sandbox can't start. Full access skips it. Claude's file and web tools are not
// shell commands and keep their own permission rules.

export const SHELL_SANDBOX_SETTING = 'shell_sandbox'          // '0' turns it off
export const SHELL_DOMAINS_SETTING = 'shell_allowed_domains'  // extra sites, one per line

/** Always allowed: package registries and GitHub, so installs, builds and git over HTTPS work. */
export const DEFAULT_SHELL_DOMAINS = [
  'github.com', '*.github.com', '*.githubusercontent.com',
  'registry.npmjs.org', '*.npmjs.org', 'registry.yarnpkg.com',
  'pypi.org', 'files.pythonhosted.org',
  'crates.io', '*.crates.io', 'proxy.golang.org', 'sum.golang.org', 'rubygems.org'
]

/** Folders shell commands may never read, even inside the sandbox. */
const DENY_READ = ['~/.ssh', '~/.aws', '~/.gnupg', '~/.config/gh', '~/.netrc', '~/.docker/config.json', '~/Library/Keychains']

const DOMAIN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$|^localhost(:\d{1,5})?$/i

/** Sites typed in Settings: one per line or comma-separated; scheme and path dropped; invalid ones skipped. */
export function parseDomains(text: string | null | undefined): string[] {
  const out: string[] = []
  for (let d of (text ?? '').split(/[\n,]+/)) {
    d = d.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
    if (d && DOMAIN.test(d) && !out.includes(d)) out.push(d)
  }
  return out
}

export function sandboxOn(setting: string | null | undefined): boolean { return setting !== '0' }

/** The `--settings` JSON for one sandboxed run. */
export function claudeSandboxSettings(extraDomains: string[] = []): string {
  const allowedDomains = [...new Set([...DEFAULT_SHELL_DOMAINS, ...extraDomains])]
  return JSON.stringify({
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
      filesystem: { denyRead: DENY_READ },
      network: { allowedDomains, strictAllowlist: true, allowLocalBinding: true }
    }
  })
}
