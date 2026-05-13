# Changelog

All notable changes to opencode-triage are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.8] — 2026-05-13

### Changed
- Minor text updates

## [1.2.7] — 2026-05-12

### Added
- `--both` flag for `/triage on` and `/triage off` to toggle both scopes simultaneously
- `/triage on --both` — hides skills in both global and local scopes
- `/triage off --both` — exposes skills in both global and local scopes
- `--both` documentation in README, AGENTS.md, and CLI help text

### Changed
- `toggle()` function now supports a third scope value (`"both"`) that iterates both global and local scopes
- Help text updated with `--both` examples and scope descriptions
- `readSkillContent()` returns `{ content, filePath }` object for benchmark accuracy
- `CMD_TEMPLATE` uses `npx -y opencode-triage` for cross-platform compatibility (was hardcoded Windows path)
- `updateGlobalConfig()` now scopes plugin removal to `"plugin"` array context only

### Fixed
- `showCompare` estimate benchmark (`indexOf` → real `fs.readFileSync`)
- `showCompare` benchmark loop missing symlink guard
- `extractFrontmatter` key param not escaped in regex (latent ReDoS)
- `safeRenameSync` redundant symlink check removed (caller already guards)

## [1.2.6] — 2026-05-12

### Added
- `notify` tool accessible by the LLM to show TUI toast notifications
- Toast notifications for "no skills installed", content truncation, and content unreadable cases in triage results
- Body-start content detection to prevent false positives when skill body text mentions error strings
- `typeof` guard on `output.output` to harden against non-string tool results
- `test/notifications.test.ts` — 21 tests covering first-line pattern matching, body extraction, false positive prevention, and edge cases

### Changed
- Consolidated duplicated constants and utility functions from `index.ts` into `utils.ts` imports
- Moved `notify.ts` into `src/` directory for correct npm packaging (`files` glob covers it now)
- Replaced inline path-traversal check with exported `isValidSkillName()` from `utils.ts`
- Updated JSDoc on all source files (`server`, `buildSkillLocations`, `discoverAllSkills`, `tryReadSkill`, `readSkillContent`)
- Synced version header comment (1.0.0 → 1.2.5)

### Removed
- `triage-notify.ts` — redundant standalone plugin; notification logic now lives in `src/index.ts`

### Fixed
- `notify.ts` missing from published npm package (was outside `src/`, not matched by `files` glob)
- Potential false positive toast when skill body text contained `(skill content truncated` or `(skill content unavailable)`


## [1.2.5] — 2026-05-12

### Changed
- Clarified cross-tool impact wording in documentation

## [1.2.4] — 2026-05-09

### Changed
- Added `.agents/`, `.claude/`, `skills-lock.json` to `.gitignore`

## [1.2.3] — 2026-04-07

### Changed
- Polished README, improved source comments, fixed directory listings

## [1.2.2] — 2026-04-05

### Changed
- Clarified token savings apply to skills only

## [1.2.1] — 2026-04-04

### Added
- Configuration combinations table to README

## [1.2.0] — 2026-04-02

### Added
- Scope-aware CLI (`--local` / `--global` flags)
- Postinstall auto-setup for command file creation
- README rewrite

## [1.1.0] — 2026-03-28

### Changed
- Restructured for npm publishing

## [1.0.3] — 2026-03-26

### Added
- Cross-tool impact documentation warning
- `.agents/skills/` directory support (vercel.sh install target)
- README user flow examples and SEO keywords

### Fixed
- Security fixes and bug fixes
- CRLF regex handling

## [1.0.0] — 2026-03-24

### Added
- Initial release: deterministic skill router for OpenCode
- Keyword-based scoring with configurable weights
- SKILL.md / SKILL.md.disabled discovery from 6 directory locations
- `/triage on|off|status` CLI
- Confidence-gap auto-routing
