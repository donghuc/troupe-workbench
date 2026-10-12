# Installing Troupe

Troupe is a Mac app that lets you work with AI agents (Claude, Codex, Grok and Gemini) side by side in one project. It doesn't include its own AI: it drives the agents' command-line tools, which you install and sign in to yourself. Your chats stay on your Mac.

## What you need

- A Mac with Apple silicon (M1 or later). Intel Macs aren't supported by this build.
- At least one agent CLI, installed and signed in. Claude is the main one; Codex, Grok and Gemini are optional.

## 1. Install at least one agent

Open **Terminal** and run the commands for the agents you want.

**Claude** (needs a Claude Pro or Max plan, or an Anthropic API account):
```
curl -fsSL https://claude.ai/install.sh | bash
claude
```
The second command opens Claude Code once so you can sign in. After you're signed in, type `/exit`.

**Codex** (needs a ChatGPT plan or an OpenAI API key), optional:
```
npm install -g @openai/codex
codex login
```
(`npm` comes with Node.js. If `npm` isn't found, install Node.js from https://nodejs.org first.)

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

## 2. Install Troupe

1. Download the latest `Troupe-<version>-arm64.dmg` from the project's GitHub **Releases** page, open it, and drag **Troupe** into **Applications**.
2. Open Troupe from Applications. macOS will say it can't check the app for malicious software, because the app isn't signed with an Apple developer certificate. Click **Done**.
3. Open **System Settings ▸ Privacy & Security**, scroll down to the message about Troupe, and click **Open Anyway**. Confirm with your password.

You only do this once. If you prefer Terminal, this does the same thing:
```
xattr -dr com.apple.quarantine /Applications/Troupe.app
```

## 3. First launch

Troupe checks which agents are installed. Any that aren't are switched off, and a note tells you so. After you install one later, turn it on in **Settings ▸ Agents**.

Create a project and connect a folder (the agents read and edit files in it), then start a chat. To make images, open **Image** in the sidebar and choose a folder for it in **Settings ▸ Image**.

## If something doesn't work

- **"CLI not found" or the agent shows "Not installed":** install it (step 1), then quit and reopen Troupe.
- **The agent shows "Signed out":** run `claude` (or `codex login`) in Terminal and sign in again.
- **An agent can't edit files:** the permission picker next to the send button is on **Read-only**. Switch it to **Auto**.

## Updating

Download the new dmg from Releases and drag Troupe into Applications again, replacing the old one. Your projects and chats are kept (they live in `~/Library/Application Support/AI Workbench`).

**Coming from 1.x:** the first launch of 2.0 or later updates the database in a way 1.x can't read. A backup of the old database is saved next to it first (`workbench.pre-v22.bak`). After that, don't go back to a 1.x build.
