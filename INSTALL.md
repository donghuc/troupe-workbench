# Installing Troupe

Troupe is a Mac app that lets you work with AI agents (Claude, Codex, Grok and Gemini) side by side in one project. It doesn't include its own AI: it drives the agents' command-line tools, which you install and sign in to yourself. Your chats stay on your Mac.

## What you need

- A Mac with Apple silicon (M1 or later). Intel Macs aren't supported by this build.
- An account for at least one agent: Claude (Pro, Max or API), ChatGPT for Codex, a Google account for Gemini, or xAI for Grok. Troupe installs and signs in to Claude, Codex and Gemini for you.

## 1. Install Troupe

1. Download the latest `Troupe-<version>-arm64.dmg` from the project's GitHub **Releases** page, open it, and drag **Troupe** into **Applications**.
2. Open Troupe from Applications. macOS will say it can't check the app for malicious software, because the app isn't signed with an Apple developer certificate. Click **Done**.
3. Open **System Settings ▸ Privacy & Security**, scroll down to the message about Troupe, and click **Open Anyway**. Confirm with your password.

You only do this once. If you prefer Terminal, this does the same thing:
```
xattr -dr com.apple.quarantine /Applications/Troupe.app
```

**"Troupe is damaged and can't be opened"?** That was a packaging bug in 2.2.0 (fixed in 2.2.1) — the app isn't damaged. Install 2.2.1 or later, or run the `xattr` command above and open it again.

## 2. Set up your agents in Troupe

The first time Troupe opens, a welcome screen lists Claude, Codex, Gemini and Grok and shows which are ready. For any that aren't:

1. Pick the agent and click **Install**. Troupe shows the official installer command and the site it downloads from, and runs it only after you confirm.
2. Click **Sign in**. A browser window opens to sign in; if the agent needs a terminal for this, Troupe opens a Terminal window with the command ready — finish there and come back.
3. The agent turns **Ready** on its own. At least one ready agent lets you continue; Claude is the recommended one.

Later, **Settings ▸ Agents ▸ Set up** does the same for any agent that isn't ready. Grok is installed by hand (see below).

## 3. Your first project

The welcome then asks for a folder (the agents read and edit files in it) and offers a first question to try. Agents that aren't ready are switched off; turn them on later in **Settings ▸ Agents**. To make images, open **Image** in the sidebar and choose a folder for it in **Settings ▸ Image**.

## Prefer Terminal?

Everything above can be done by hand. These are the same commands Troupe runs.

Open **Terminal** and run the commands for the agents you want.

**Claude** (needs a Claude Pro or Max plan, or an Anthropic API account):
```
curl -fsSL https://claude.ai/install.sh | bash
claude
```
The second command opens Claude Code once so you can sign in. After you're signed in, type `/exit`.

**Codex** (needs a ChatGPT plan or an OpenAI API key), optional:
```
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex login
```
(If you already use Node.js, `npm install -g @openai/codex` works too.)

**Grok**, optional: install the Grok CLI following xAI's instructions and sign in.

**Gemini**, optional (needs a Google account): install Google's Antigravity CLI, then run it once to sign in, and type `/exit`:
```
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy
```
To let Gemini read web pages for research, open `~/.gemini/antigravity-cli/settings.json` and add:
```json
{ "permissions": { "allow": ["read_url(*)"] } }
```

To check what's installed:
```
which claude codex grok agy
```
Each installed agent prints a path.

## If something doesn't work

- **"CLI not found" or the agent shows "Not installed":** install it (step 1), then quit and reopen Troupe.
- **The agent shows "Signed out":** run `claude` (or `codex login`) in Terminal and sign in again.
- **An agent can't edit files:** the permission picker next to the send button is on **Read-only**. Switch it to **Auto**.

## Updating

Download the new dmg from Releases and drag Troupe into Applications again, replacing the old one. Your projects and chats are kept (they live in `~/Library/Application Support/AI Workbench`).

**Coming from 1.x:** the first launch of 2.0 or later updates the database in a way 1.x can't read. A backup of the old database is saved next to it first (`workbench.pre-v22.bak`). After that, don't go back to a 1.x build.
