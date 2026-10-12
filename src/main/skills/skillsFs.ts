import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getDb } from '../database/db'
import { getSetting, setSetting } from '../database/settingsRepo'
import { app } from 'electron'
import { createProvider } from '../providers/registry'
import type { Skill, SkillInput, SkillScope } from '../../shared/types'
import { BUILTIN_SKILLS, BUILTIN_SLUGS, builtinBySlug } from './builtinSkills'
import { isUneditedOldBuiltin } from './builtinVersions'
import { logInfo } from '../util/logger'

// File-based skills (D-018): skills are Claude Code SKILL.md files, so they're
// picked up natively by Claude Code and interoperate with the user's terminal.
// Global = ~/.claude/skills/<slug>/SKILL.md; project = <cwd>/.claude/skills/....
// Our custom `triggers` frontmatter key drives auto-match (D-017) + Codex; Claude
// ignores unknown keys and uses `description` for its own invocation.
const GLOBAL_DIR = (): string => join(homedir(), '.claude', 'skills')
const PROJECT_DIR = (cwd: string): string => join(cwd, '.claude', 'skills')

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'skill'
}

// Minimal YAML-frontmatter parse (key: value, optional quotes) — avoids a dep.
function parse(text: string): { fm: Record<string, string>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { fm: {}, body: text.trim() }
  const fm: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const key = line.slice(0, i).trim()
    let val = line.slice(i + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    fm[key] = val
  }
  return { fm, body: m[2].trim() }
}

function serialize(name: string, description: string, triggers: string, body: string): string {
  const q = (s: string): string => `"${(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  const lines = ['---', `name: ${q(name)}`, `description: ${q(description)}`]
  if (triggers && triggers.trim()) lines.push(`triggers: ${q(triggers)}`)
  lines.push('---', '', body.trim(), '')
  return lines.join('\n')
}

function readDir(base: string, scope: SkillScope): Skill[] {
  let slugs: string[] = []
  try { slugs = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch { return [] }
  const out: Skill[] = []
  for (const slug of slugs) {
    try {
      const { fm, body } = parse(readFileSync(join(base, slug, 'SKILL.md'), 'utf8'))
      out.push({ id: `${scope}/${slug}`, name: fm.name || slug, description: fm.description || '', triggers: fm.triggers || '', body, scope, builtin: scope === 'global' && BUILTIN_SLUGS.has(slug) })
    } catch { /* skip dirs without a readable SKILL.md */ }
  }
  return out
}

// No cwd → global skills; cwd → that project's skills. Callers merge as needed.
export function listSkills(cwd?: string): Skill[] {
  const [base, scope]: [string, SkillScope] = cwd ? [PROJECT_DIR(cwd), 'project'] : [GLOBAL_DIR(), 'global']
  return readDir(base, scope).sort((a, b) => a.name.localeCompare(b.name))
}

function dirForId(id: string, cwd?: string): { base: string; slug: string; scope: SkillScope } | null {
  const slash = id.indexOf('/')
  if (slash < 0) return null
  const scope = id.slice(0, slash) as SkillScope
  const slug = id.slice(slash + 1)
  if (scope === 'global') return { base: GLOBAL_DIR(), slug, scope }
  if (scope === 'project' && cwd) return { base: PROJECT_DIR(cwd), slug, scope }
  return null
}

export function getSkillById(id: string, cwd?: string): Skill | null {
  const d = dirForId(id, cwd); if (!d) return null
  try {
    const { fm, body } = parse(readFileSync(join(d.base, d.slug, 'SKILL.md'), 'utf8'))
    return { id, name: fm.name || d.slug, description: fm.description || '', triggers: fm.triggers || '', body, scope: d.scope, builtin: d.scope === 'global' && BUILTIN_SLUGS.has(d.slug) }
  } catch { return null }
}

function uniqueSlug(base: string, slug: string): string {
  let s = slug, n = 2
  while (existsSync(join(base, s))) s = `${slug}-${n++}`
  return s
}

export function createSkill(input: SkillInput, cwd?: string): Skill {
  const useProject = input.scope === 'project' && !!cwd
  const base = useProject ? PROJECT_DIR(cwd!) : GLOBAL_DIR()
  const scope: SkillScope = useProject ? 'project' : 'global'
  const slug = uniqueSlug(base, slugify(input.name))
  mkdirSync(join(base, slug), { recursive: true })
  writeFileSync(join(base, slug, 'SKILL.md'), serialize(input.name, input.description || '', input.triggers || '', input.body), 'utf8')
  return { id: `${scope}/${slug}`, name: input.name, description: input.description || '', triggers: input.triggers || '', body: input.body, scope }
}

export function updateSkill(id: string, patch: Partial<SkillInput>, cwd?: string): Skill {
  const cur = getSkillById(id, cwd); if (!cur) throw new Error('skill not found')
  const d = dirForId(id, cwd)!
  const name = patch.name ?? cur.name
  const description = patch.description ?? cur.description
  const triggers = patch.triggers ?? cur.triggers
  const body = patch.body ?? cur.body
  writeFileSync(join(d.base, d.slug, 'SKILL.md'), serialize(name, description, triggers, body), 'utf8')
  return { id, name, description, triggers, body, scope: cur.scope, builtin: cur.builtin }
}

export function deleteSkill(id: string, cwd?: string): void {
  const d = dirForId(id, cwd); if (!d) return
  try { rmSync(join(d.base, d.slug), { recursive: true, force: true }) } catch { /* noop */ }
}

// Run once at startup: seed the built-in skills as files (create if missing), then
// migrate any pre-existing DB skills (from the old DB-backed model) into globals.
export function seedAndMigrateSkills(): void {
  try {
    mkdirSync(GLOBAL_DIR(), { recursive: true })
    for (const b of BUILTIN_SKILLS) {
      const dir = join(GLOBAL_DIR(), b.slug)
      const file = join(dir, 'SKILL.md')
      const canonical = serialize(b.name, b.description, b.triggers, b.body)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
        writeFileSync(file, canonical, 'utf8')
        continue
      }
      // Upgrade a copy the user never edited (D-064): it matches an earlier shipped
      // version exactly. Edited copies are left alone — Reset to default updates those.
      let cur = ''
      try { cur = readFileSync(file, 'utf8') } catch { continue }
      if (isUneditedOldBuiltin(cur, canonical)) {
        writeFileSync(file, canonical, 'utf8')
        logInfo(`[skills] updated built-in skill ${b.slug} to the current version`)
      }
    }
  } catch { /* home dir not writable — non-fatal */ }
  if (getSetting('skills_files_migrated') === '1') return
  try {
    const rows = getDb().prepare('SELECT name, body, triggers FROM skills').all() as { name: string; body: string; triggers: string }[]
    for (const r of rows) {
      if (BUILTIN_SLUGS.has(slugify(r.name))) continue // already seeded as a built-in
      if (existsSync(join(GLOBAL_DIR(), slugify(r.name)))) continue
      createSkill({ name: r.name, body: r.body, triggers: r.triggers || '', description: '', scope: 'global' })
    }
  } catch { /* skills table may not exist */ }
  setSetting('skills_files_migrated', '1')
}

// Rewrite a built-in skill's file from its canonical definition (Reset to default).
// Only global built-ins can be reset; anything else is a no-op returning the current skill.
export function resetBuiltinSkill(id: string): Skill | null {
  const d = dirForId(id)
  if (!d || d.scope !== 'global') return getSkillById(id)
  const b = builtinBySlug(d.slug)
  if (!b) return getSkillById(id)
  mkdirSync(join(GLOBAL_DIR(), b.slug), { recursive: true })
  writeFileSync(join(GLOBAL_DIR(), b.slug, 'SKILL.md'), serialize(b.name, b.description, b.triggers, b.body), 'utf8')
  return { id: `global/${b.slug}`, name: b.name, description: b.description, triggers: b.triggers, body: b.body, scope: 'global', builtin: true }
}


// Agent-authored skill: ask Claude to write a proper skill spec for a purpose,
// then persist it as a SKILL.md. Runs the provider directly (no conversation).
export async function draftSkill(purpose: string, scope: SkillScope, cwd?: string): Promise<Skill> {
  const provider = createProvider('claude-code')
  if (!provider) throw new Error('Claude provider unavailable')
  const prompt = [
    'Author a reusable Claude Code skill for this purpose:',
    purpose.trim(),
    '',
    'Output ONLY a fenced ```json block with these keys:',
    '- name: a short skill name',
    '- description: one line describing when to use it',
    '- triggers: comma-separated keywords that should auto-apply it (may be empty)',
    '- body: the skill instructions in Markdown (what the AI should do when applied)',
    'No prose outside the JSON block.'
  ].join('\n')
  let text = ''
  for await (const ev of provider.run({ prompt, context: {}, cwd: cwd || app.getPath('temp') }, undefined)) {
    if (ev.type === 'text_delta') text += ev.text
    else if (ev.type === 'error' && ev.fatal) throw new Error(ev.message)
  }
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)
  const brace = text.match(/\{[\s\S]*\}/)
  const raw = (fenced ? fenced[1] : brace ? brace[0] : text).trim()
  let parsed: { name?: string; description?: string; triggers?: string; body?: string }
  try { parsed = JSON.parse(raw) } catch { throw new Error('Could not parse the drafted skill (agent did not return valid JSON).') }
  if (!parsed.body || !parsed.body.trim()) throw new Error('The drafted skill had no instructions.')
  return createSkill({
    name: parsed.name?.trim() || 'Untitled skill',
    description: parsed.description?.trim() || '',
    triggers: typeof parsed.triggers === 'string' ? parsed.triggers : '',
    body: parsed.body,
    scope
  }, cwd)
}
