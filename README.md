## 📄 BrainBox README

### BrainBox

BrainBox lets you build, run, and chat with **AI personas that feel like real people** on several messangers.

Each persona has its own memories, daily rhythm, mood, and the small habits that make a person recognisable. Tell BrainBox about a character — a paragraph is enough — and a daemon will spin them up, give them a schedule, and start talking to you like a person would: sometimes at once, sometimes after a while, sometimes telling you they're busy and will reply later.

### What it looks like in practice

You give BrainBox a one-line description like:

> a tired café owner who sketches in her notebook when nobody's around

BrainBox builds that into a real persona:

- a **personality** (how she talks, what she cares about)
- a **daily schedule** (when she opens the café, when she sketches, when she sleeps)
- **memories** that grow as you talk to her

Then she runs on a Discord or Telegram account. She greets you. She replies when it makes sense. Sometimes she's offline — because the schedule says so, or because she's in the middle of something. She remembers what you talked about yesterday.

### Getting started

**1. Install**

```
bun install
```

**2. Onboard** (one-time interactive setup)

```
brainbox onboard
```

Walks you through provider+api key, default model, supermemory key, your first brain, and a channel binding. To set those up by hand instead, follow the steps below.

**3. Create a persona**

```
brainbox brain create "Mina" "a tired café owner who sketches in her notebook when nobody's around"
```

BrainBox will think for a few seconds, then print something like:

```
Created brain "Mina" (a4f8e2-...)
```

The brain now exists on disk and is **inactive**. She has no channel yet.

**4. Wire her up to a messenger**

_Option A — explicit binding._ If you already know which Discord channel (or Telegram chat) she should live in, edit `brains.json` to set the `channelId` (or `chatId`) and token, then activate:

```
brainbox brain activate <brainId>
```

_Option B — pairing._ Activate the brain, run the daemon, and let BrainBox ask the persona's channel for a one-time pairing code. This is what you use when you don't want to hard-code a channel ID.

```
brainbox brain activate <brainId>
brainbox daemon
```

Send the persona any message on her channel, and the daemon will print a pairing code. Then in another terminal:

```
brainbox pairing <code>
```

BrainBox binds the brain to that channel automatically.

**5. Start the daemon**

If you haven't already:

```
brainbox daemon
```

This starts a long-running process. Every activated brain gets its own connection to its platform. The daemon stays alive, manages all of them at once, and writes its control socket to `<brainboxRoot>/daemon.sock` so you can manage it from another terminal.

### Talking to your personas

Once a brain is active and paired, just message her like you'd message a friend. She'll reply in character.

A few things worth knowing about how she behaves:

- **She has a daily rhythm.** She's reachable during the hours her schedule says she is. Outside of those hours, she'll see your message but won't reply until she's "around" again. Nothing is lost.
- **Sometimes she takes a moment to think.** If you send a flurry of messages ("hi", "you there?", "hello???"), she'll wait until you stop typing before answering — same as a person reading all three before responding.
- **Sometimes she doesn't reply right away.** If she's busy (a meeting, sketching, sleeping), there's a chance your message waits. The longer it sits, the higher the chance she'll get back to you eventually.
- **She's not always the one to start.** A few times a day, she'll reach out first — a quick thought, a question, a "morning." How often and when depends on the persona.
- **She sleeps.** Every day, while she's offline, BrainBox consolidates the day's conversations into a journal entry. Tomorrow she'll remember.

### Commands at a glance

```
brainbox onboard                               # one-time interactive setup
brainbox brain list                            # show all brains and their state
brainbox brain create <name> [seed]            # build a new persona
brainbox brain remove <brainId>                # delete a brain and its memory
brainbox brain activate <brainId>              # include in next daemon start
brainbox brain deactivate <brainId>            # stop loading on daemon start

brainbox daemon                                # run the daemon
brainbox pairing <code>                        # complete channel pairing
```

### Running more than one persona

BrainBox supports many personas in parallel. Create as many as you like, set each one up with a channel, activate them, and start the daemon once. They all run together inside the same process — each with their own schedule, memory, and personality, each reachable on their own channel.

There's a guardrail though: **one channel hosts exactly one persona**. Two personas cannot share a Discord channel or Telegram chat. This is intentional — it keeps each persona's memories from mixing with another's.

### What's actually persisted

Each persona lives in `brains.json` (configurable location). A persona is:

- her **personality** (the system prompt BrainBox generated)
- her **chat token** and channel binding
- her **mood dial** (`dndReplyProbability`) — how likely she is to reply when she's busy
- her **reach-out dials** — how many unsolicited messages she'll send per day, and how long to wait after a chat before reaching out again
- whether she's **active**

Everything else — schedules, journals, conversations — lives in the memory backend and is created automatically.

### Where things go wrong (and what to expect)

| Symptom                             | What's happening                                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Persona is active but never replies | No inbound yet → she can't determine where to send. Send her a message first.                                                             |
| Persona says "no channel yet"       | The daemon started but the persona was never paired or never received an inbound.                                                         |
| Replies are delayed                 | Either she's dnd and waiting for a better moment, or you kept typing and she's waiting for you to stop.                                   |
| Persona never reaches out first     | Her reach-out threshold is set conservatively, or she's been "chatting" recently and is in cooldown.                                      |
| Restart didn't pick up a new brain  | The daemon holds running state in memory. Restart it with `brainbox restart` (or stop and start it manually) after activating new brains. |
