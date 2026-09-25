# OSRS Jad Simulator

Prayer-switching practice for TzTok-Jad, in the browser, with OSRS numbers.

Lineage: the original RS3 simulator by [runeapps.org](https://runeapps.org/jadsim_app) → OSRS asset swap by [@downthecrop](https://github.com/downthecrop/JS-OSRS-Jad-Simulator) → this fork, which rewrites the engine and adds feedback.

Open `index.html` (or serve the folder) and press **Start fight**.

## What this fork adds

**OSRS numbers instead of RS3 ones**
- 99 hp / 99 prayer (or 80/70, 85/52), not 9001 life points.
- Jad hits up to 97 (ranged) / 95 (magic); attacks every 8 ticks (4.8 s).
- Protect prayers drain `12 / (2 × prayer bonus + 60)` points per tick — the real formula — with a +0/+15/+30 bonus setting.
- Saradomin brew heals 15% + 2 (to 115 at 99 hp); super restore gives 25% + 8 prayer; 3-tick potion delay; 1 hp/min regen.
- Prayer is checked when the hit lands (~3.4 s into the animation), matching the wiki's timing. *Hard* (2.4 s) and *Brutal* (1.8 s) shrink the window.
- Ranged sound plays only after the boulder lands, as in game, so you have to read the animation (toggle off to get the old early cue).

**Feedback**
- Live HUD: streak, personal best, blocked/attacks, average reaction time on switches.
- Summary also shows damage dealt and hit rate.
- End-of-fight summary: accuracy, switches needed, average and fastest reaction, damage taken, potions used, prayer points used, duration.
- Best streak is remembered between sessions.

**You actually fight**
- Click Jad to attack; you keep shooting until you click something else. Weapons: toxic blowpipe (2-tick rapid, max 29), twisted bow (5-tick, max 80 on Jad, 30 on healers), rune crossbow (5-tick, max 46). Floating hitsplats and a cooldown pip under your hp bar.

**Healer phase** (*Kill Jad + healers*)
- Jad has 250 hp. At half, four Yt-HurKots spawn beside him and heal him 5 hp/tick each.
- Cardinal rule, enforced: a healer that is on you cannot heal Jad. A counter beside his HP bar shows how many are healing / on you / dead at every moment.
- Click a healer to shoot it once: that draws it — it stops healing for good, walks to you over 5 ticks and stays on you, meleeing for up to 14 every 4 ticks (Protect from Melee blocks it, but you're busy). It never goes back to Jad. Click Jad again to resume on him, or finish the healer (60 hp).
- *Invulnerable healers* (default on) keeps them at 1 hp minimum so tag-and-park practice can't kill one by accident; turn it off for the real rule below.
- Like in game, you keep attacking whatever you last clicked — after tagging a healer, click Jad to get back on him (or it dies in a few more shots). *Auto back to Jad after tag* in setup does the click for you if you want it.
- If Jad is healed back to full while any healer is dead, the dead ones return the next time he drops below half — the wiki's rule.
- Win screen on the kill; the summary reports how fast you drew all four, how much he was healed, and what the healers did to you.

**Quality of life**
- Rebindable inventory / prayer keys (defaults Esc / 1, which never need the fn key; OSRS's F4 / F5 are one click away). Any key works, Esc included — Mac users, either enable "Use F1, F2, etc. as standard function keys" in System Settings or bind something like Esc + 1 and mirror it with RuneLite's Key Remapping plugin. P pauses, End stops, Enter starts.
- The 765×503 interface scales to the window.
- Settings persist. No `eval`, no string-built timers; a drift-corrected tick loop.
- `window.jadsim` exposes live state and settings for tooling.

## Files

- `index.html` — markup and settings panel
- `styles.css` — layout and RuneScape-styled panels
- `sim.js` — engine, drawing, stats
- everything else — the original sprites, animations and sounds

`fkeyfix.js` from the original is no longer used; key handling lives in `sim.js`.

## License

BSD Zero Clause, as the original. Credit: runeapps.org for the simulator, @downthecrop for the OSRS assets.
