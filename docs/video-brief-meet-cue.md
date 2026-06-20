# 🎬 Designer Brief: "Meet cue" — Animated Explainer

**Deliverable:** 60–90s animated explainer video
**Use:** Landing page hero + social (deliver 16:9 master + 9:16 and 1:1 cutdowns)
**Tone:** Funny, fast, a little chaotic — think *Duolingo meets a developer who's had too much coffee*. Smart humor, not cringe. No corporate stock-vibe.

---

## The Core Idea (the joke that carries the video)

An AI coding agent (`claude` / `codex`) is a brilliant but *over-eager intern* who shows up to every job with **all the tools at once** — wearing a tool belt with 47 hammers, a flamethrower, and a rubber duck — and predictably causes chaos. **cue** is the calm, deadpan "stage manager" character standing just offstage who hands the intern *exactly the right tools for this room* the moment they walk in, then quietly steps back.

Tagline to land on: **"cue. The right agent, on cue."**

---

## Characters

- **The Intern (the Agent):** googly-eyed, enthusiastic, slightly unhinged robot/blob. Great at the work, terrible at restraint. Visual gag: tools constantly bursting out of its pockets.
- **cue (the hero):** a sleek, unbothered clipboard-or-curtain character (think theater stage manager with a headset). Deadpan. Snaps fingers / taps a cue card and the right setup *materializes*.
- **The Rooms (cwd = current folder):** each project folder is a literal themed "room" the intern walks into — a frontend room, a security room, a writing room.

---

## What cue actually does (keep these 3 beats accurate — this is the substance)

1. **Resolves the profile from where you are.** Walk into a folder → cue instantly knows which "profile" fits (e.g. `core`, frontend, security).
2. **Materializes the right runtime.** Only the relevant **skills** and **MCP servers** snap into place — not the entire kitchen sink.
3. **Then gets out of the way.** cue execs the *real* `claude`/`codex` — same agent, just correctly equipped. It's a layer between your shell and the binary, invisible once it's done.

---

## Suggested Script / Storyboard (90s)

| Time | Visual | VO / Text |
|---|---|---|
| 0–8s | Intern robot kicks open a door into a tidy "frontend" room, *immediately* dumps 200 tools on the floor, sets a small fire. | "This is your AI coding agent. Brilliant… with zero chill." |
| 8–18s | Tools labels fly by: random MCP servers, 50 skills, security tools in a design folder. Intern confused, sweating. | "Every tool, every time. In every project. What could go wrong?" (everything visibly goes wrong) |
| 18–28s | cue slides in from offstage, taps a **cue card**. Snap! All the junk vanishes; only 3 relevant tools gently float down. | "Meet **cue** — your agent's stage manager." |
| 28–45s | Split-screen of folders/rooms. Intern walks into each; cue swaps the loadout per room *automatically* based on the door sign (the folder). | "It reads the room — literally your folder — and hands over the right profile." |
| 45–60s | Close-up: skill cards + MCP plugs *click* into the intern's belt like Lego. Satisfying snap SFX. | "The right skills. The right MCP servers. Materialized on the spot." |
| 60–72s | cue steps back behind the curtain; intern, now calm and competent, ships code. cue is *invisible*. | "Then it gets out of the way — it's just real `claude` and `codex`, finally equipped." |
| 72–90s | Logo build. Intern gives a tiny thumbs up; a rubber duck honks. | **"cue. The right agent, on cue."** + install CTA |

---

## Visual Style

- **Look:** flat-vector 2.5D with chunky shapes, bold outlines, playful squash-and-stretch. Mograph energy, not realistic.
- **Color:** dark-terminal background as a recurring motif (it's a CLI tool) + 2 punchy accent colors for cue vs. the chaos. Keep cue's color cool/calm, the chaos warm/loud.
- **Type:** monospace for anything code-y (folder names, `cue current`, skill names); rounded sans for jokes/VO captions.
- **Signature motion:** the **"snap-into-place"** — wrong stuff dissolves, right stuff magnetically clicks in. This is the money shot; reuse it 2–3 times so it becomes the brand gesture.

---

## Comedy Guardrails (so it stays funny, not silly)

- Humor comes from the **intern's over-eagerness** and cue's **deadpan competence** — contrast is the joke.
- Quick cuts, one visual gag every ~5s, generous SFX (snaps, honks, error-buzzes, a triumphant "ding").
- Don't mock the user or the agent's intelligence — the agent is *good*, just unmanaged. cue makes it look great.

---

## Technical Specs

- **Length:** 90s master; also cut a **15s teaser** (beats: chaos → snap → tagline).
- **Ratios:** 16:9, 9:16, 1:1. Keep critical action in a center-safe frame so cutdowns work.
- **Captions:** burned-in optional + clean caption file (most social plays muted — the video must read with **sound off**).
- **End card:** logo, tagline, install one-liner, 2s hold.
- **Audio:** upbeat quirky bed (light synth/marimba), strong SFX layer, optional dry deadpan VO for cue's lines.

---

## One-line prompt (drop into an AI video/animation tool)

> *"A funny 90-second flat-vector 2.5D animated explainer with a dark-terminal aesthetic. An over-eager googly-eyed robot intern (the AI coding agent) storms into themed 'project folder' rooms carrying way too many tools and causing chaos; a calm, deadpan stage-manager character named 'cue' taps a cue card and the wrong tools dissolve while exactly the right skills and MCP-server tools magnetically snap into its tool belt. cue then steps behind the curtain and the now-competent intern ships code. Punchy snap SFX, one visual gag every 5 seconds, monospace code labels, ending on the logo and tagline 'cue. The right agent, on cue.'"*
