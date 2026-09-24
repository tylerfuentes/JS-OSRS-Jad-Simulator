// OSRS Jad Simulator — prayer-switching practice with OSRS numbers, reaction stats and the healer phase.
// Lineage: runeapps.org RS3 jad sim → @downthecrop OSRS asset swap → this rewrite (no eval, drift-corrected ticks).
(() => {
  'use strict';

  // ---------- constants ----------
  const TICK = 600;                       // one game tick, ms
  const ATTACK_CYCLE = 8;                 // Jad attacks every 8 ticks (4.8 s)
  const POTION_DELAY = 3;                 // ticks between potions
  const HP_REGEN_TICKS = 100;             // 1 hp per minute
  const PROTECT_DRAIN_EFFECT = 12;        // protect prayers: 12 / (2·bonus + 60) points per tick
  const JAD_HP = 250;
  const JAD_MAX = { magic: 95, ranged: 97 };
  const STYLE = { magic: 1, ranged: 2 };  // prayprot codes: 1 magic, 2 missiles, 3 melee
  const HEALER_HP = 60, HEALER_MAX = 14, HEALER_SPEED = 4, HEALER_ACC = 0.4;
  const HEALER_SETTLE_TICKS = 3;          // ticks after spawning before a healer starts healing Jad
  const HEALER_HEAL = 5;                  // hp per undrawn healer per tick
  const HEALER_WALK_TICKS = 5;            // ticks for a drawn healer to reach you
  const WEAPONS = {                       // ranged, at distance: [attack speed in ticks, max vs Jad, max vs healers, accuracy vs Jad, vs healers]
    blowpipe: { name: 'Toxic blowpipe (rapid)', speed: 2, maxJad: 29, maxHealer: 29, accJad: 0.78, accHealer: 0.9 },
    tbow:     { name: 'Twisted bow (rapid)',    speed: 5, maxJad: 80, maxHealer: 30, accJad: 0.9,  accHealer: 0.85 },
    rcb:      { name: 'Rune crossbow (rapid)',  speed: 5, maxJad: 46, maxHealer: 46, accJad: 0.7,  accHealer: 0.85 },
  };

  const LEVELS = { max: [99, 99], med: [80, 70], pure: [85, 52] };
  const BREW = 13, RESTORE = 23, EMPTY = 1;     // potion codes: 10..13 brew doses 1-4, 20..23 restore doses, 1 empty vial
  const INVENTORIES = {
    packed: () => Array.from({ length: 28 }, (_, i) => (i % 4 === 3 ? RESTORE : BREW)),
    normal: () => [BREW, BREW, BREW, BREW, BREW, BREW, RESTORE, RESTORE].concat(Array(20).fill(0)),
    empty:  () => [10, EMPTY, EMPTY, 11, EMPTY, 21, 22, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, 20].concat(Array(15).fill(0)),
  };

  // interface geometry (765×503 stage)
  const VIEW = { x: 4, y: 4, w: 512, h: 334 };
  const PLAYER = { overhead: [242, 102], hpbar: [229, 133], splat: [230, 144] };
  const TAB = { x: 519, y: 168, w: 246, h: 335 };
  const INV = { x: 564, y: 213, cols: 4, rows: 7, dx: 42, dy: 36, size: 32 };
  const PRAY_ROW = { y: 317, h: 36, x0: 589, dx: 37 };      // protect prayers are the 2nd–4th icons of the 4th row
  const PRAY_ON = { y: 323, x: [null, 587, 624, 661] };
  const JAD_BOX = { x: 22, y: 18, w: 116, h: 96 };                       // where Jad stands in the animation
  const HEALER_HOME = [[150, 52], [154, 96], [120, 128], [70, 130]];       // spawn beside Jad
  const HEALER_DRAWN = [[214, 150], [300, 150], [222, 188], [292, 188]];   // where they stop once drawn to you
  const PLAYER_POS = [256, 128];

  // ---------- assets ----------
  const img = {};
  ['interface_base', 'alltabs', 'allprays', 'overheadprays', 'hpbar', 'digits', 'hitsplats', 'hpicon', 'potions']
    .forEach((n) => { img[n] = new Image(); img[n].src = n + '.png'; });
  const $ = (id) => document.getElementById(id);
  const cvs = $('maincvs'), ctx = cvs.getContext('2d');
  const hud = $('hud'), hctx = hud.getContext('2d');
  const vid = { magic: $('mageattack'), ranged: $('rangeattack') };
  const snd = { magic: $('a_mage'), ranged: $('a_range'), deflect: $('a_deflect'), potion: $('a_potion') };

  // ---------- settings (persisted) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('jadsim.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('jadsim.' + k, JSON.stringify(v)); } catch {} },
  };
  const SETTINGS_VERSION = 2;
  const settings = Object.assign({
    lvl: 'max', bonus: 0, inv: 'packed', ping: 40, window: 3400, fight: 'healers', weapon: 'blowpipe',
    volume: 0.5, blind: false, lateRange: true, keyInv: 'Escape', keyPray: '1',
  }, store.get('settings', {}));
  if ((settings.v || 1) < SETTINGS_VERSION) { settings.fight = 'healers'; settings.keyInv = 'Escape'; settings.keyPray = '1'; settings.v = SETTINGS_VERSION; store.set('settings', settings); }
  let bestStreak = store.get('bestStreak', 0);

  function applySettingsToForm() {
    for (const name of ['lvl', 'bonus', 'inv', 'ping', 'window', 'fight', 'weapon']) {
      const el = document.querySelector(`input[name="${name}"][value="${settings[name]}"]`); if (el) el.checked = true;
    }
    $('volrange').value = settings.volume; $('blind').checked = settings.blind; $('lateRange').checked = settings.lateRange;
    const show = (k) => (k === 'Escape' ? 'Esc' : k); $('key-inv').textContent = show(settings.keyInv); $('key-pray').textContent = show(settings.keyPray);
    $('bestline').textContent = bestStreak ? `Best streak: ${bestStreak}` : '';
  }
  function readForm() {
    for (const name of ['lvl', 'inv', 'fight', 'weapon']) settings[name] = document.querySelector(`input[name="${name}"]:checked`).value;
    for (const name of ['bonus', 'ping', 'window']) settings[name] = Number(document.querySelector(`input[name="${name}"]:checked`).value);
    settings.volume = Number($('volrange').value); settings.blind = $('blind').checked; settings.lateRange = $('lateRange').checked;
    store.set('settings', settings);
  }
  function setVolume(v) { const a = v * v * v; Object.values(snd).forEach((s) => { s.volume = a; }); }

  // ---------- state ----------
  const S = {};
  function resetState() {
    const [hp, pr] = LEVELS[settings.lvl];
    Object.assign(S, {
      running: false, paused: false, tick: 0, startedAt: 0, pausedMs: 0, pauseStart: 0,
      maxHp: hp, hp, maxPray: pr, pray: pr, prayprot: 0, invtab: 1,
      potions: INVENTORIES[settings.inv](), potCooldown: 0,
      cooldown: 2, attack: null, attackId: 0, splat: null,
      jadHp: JAD_HP, healers: [], healersSpawned: false, healersAt: 0, jadDead: false, dead: false,
      target: null, playerCd: 0, floats: [], usedTab: false,
      stats: { attacks: 0, blocked: 0, missed: 0, switches: 0, rxSum: 0, rxBest: null, streak: 0, best: 0, dmg: 0, brews: 0, restores: 0, prayUsed: 0, healed: 0, dealt: 0, hits: 0, shots: 0, drawMs: null, healerDmg: 0 },
      chat: [],
    });
  }

  // ---------- chat ----------
  function say(text, sys) {
    S.chat.push({ text, sys }); if (S.chat.length > 5) S.chat.shift();
    $('chatbox').innerHTML = S.chat.map((c) => `<div${c.sys ? ' class="sys"' : ''}>${c.text}</div>`).join('');
  }

  // ---------- drawing: main canvas ----------
  function drawAll() {
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.drawImage(img.interface_base, 0, 0);
    drawTab(); drawOrbs();
  }
  function drawTab() {
    ctx.clearRect(TAB.x, TAB.y, TAB.w, TAB.h);
    ctx.drawImage(img.interface_base, TAB.x, TAB.y, TAB.w, TAB.h, TAB.x, TAB.y, TAB.w, TAB.h);
    if (S.invtab === 0) {
      ctx.drawImage(img.alltabs, 0, 0, 246, 335, TAB.x, TAB.y, 246, 335);
      S.potions.forEach((p, i) => {
        const x = INV.x + (i % INV.cols) * INV.dx, y = INV.y + Math.floor(i / INV.cols) * INV.dy;
        if (p >= 10 && p <= 13) ctx.drawImage(img.potions, 32 * (p - 9), 0, 32, 32, x, y, 32, 32);
        else if (p >= 20 && p <= 23) ctx.drawImage(img.potions, 32 * (p - 19), 32, 32, 32, x, y, 32, 32);
        else if (p === EMPTY) ctx.drawImage(img.potions, 0, 0, 32, 32, x, y, 32, 32);
      });
    } else {
      ctx.drawImage(img.alltabs, 246, 0, 246, 335, TAB.x, TAB.y, 246, 335);
      if (S.prayprot) ctx.drawImage(img.allprays, 37 * S.prayprot, 72, 37, 36, PRAY_ON.x[S.prayprot], PRAY_ON.y, 37, 36);
    }
  }
  function drawDigits(value, x, y, colorCol) {
    // digits.png: 10px-wide colour columns (green/yellow/orange/red, then white for hitsplats), 12px per digit
    let l = 0;
    for (const ch of String(value)) {
      const d = Number(ch);
      ctx.drawImage(img.digits, 10 * colorCol, d * 12, 6, 12, x + l, y, 6, 12);
      l += d === 1 ? 4 : d === 4 ? 5 : (d === 3 || d === 5 || d === 7) ? 6 : 7;
    }
  }
  function drawOrbs() {
    ctx.clearRect(515, 44, 60, 62);
    ctx.drawImage(img.interface_base, 515, 44, 60, 62, 515, 44, 60, 62);
    const orb = (frac, sx, x, y) => {
      const d = Math.max(0, Math.min(25, 25 - Math.floor(frac * 25)));
      if (d < 25) ctx.drawImage(img.hpicon, sx, d, 57, 25 - d, x, y + d, 57, 25 - d);
      if (d > 0) ctx.drawImage(img.hpicon, sx, 25, 57, d, x, y, 57, d);
    };
    orb(S.hp / S.maxHp, 0, 516, 45); orb(S.pray / S.maxPray, 57, 515, 78);
    const col = (frac) => (frac < 0.25 ? 3 : frac < 0.5 ? 2 : frac < 0.75 ? 1 : 0);
    drawDigits(Math.max(0, S.hp), 524, 57, col(S.hp / S.maxHp));
    drawDigits(Math.max(0, Math.floor(S.pray)), 526, 91, col(S.pray / S.maxPray));
  }

  // ---------- drawing: HUD canvas (everything dynamic inside the viewport) ----------
  function drawHud() {
    hctx.clearRect(0, 0, hud.width, hud.height);
    if (!S.running && !S.dead && !S.jadDead) return;
    // player overhead + hp bar
    if (S.prayprot) hctx.drawImage(img.overheadprays, 0, 30 * (S.prayprot - 1), 29, 29, PLAYER.overhead[0], PLAYER.overhead[1], 29, 29);
    const a = Math.max(1, Math.min(57, Math.floor(S.hp / S.maxHp * 56) + 1));
    hctx.drawImage(img.hpbar, 0, 1, a, 8, PLAYER.hpbar[0], PLAYER.hpbar[1], a, 8);
    hctx.drawImage(img.hpbar, a, 10, 58 - a, 8, PLAYER.hpbar[0] + a, PLAYER.hpbar[1], 58 - a, 8);
    // hitsplat
    if (S.splat && performance.now() < S.splat.until) {
      const [x, y] = PLAYER.splat;
      if (S.splat.value === 0) hctx.drawImage(img.hitsplats, 0, 0, 52, 30, x, y, 52, 30);
      else {
        hctx.drawImage(img.hitsplats, 0, 30 + 20 * (S.splat.style - 1), 20, 20, x, y, 20, 20);
        let l = 0; for (const ch of String(S.splat.value)) { hctx.drawImage(img.digits, 40, Number(ch) * 12, 8, 12, x + 26 + l, y + 4, 8, 12); l += 7; }
      }
    }
    // stats
    hctx.font = '15px "RuneScape Chat", monospace'; hctx.textBaseline = 'top';
    const line = (txt, x, y, color = '#ffb83f') => { hctx.fillStyle = '#000'; hctx.fillText(txt, x + 1, y + 1); hctx.fillStyle = color; hctx.fillText(txt, x, y); };
    const st = S.stats, acc = st.attacks ? Math.round(st.blocked / st.attacks * 100) : 100;
    line(`Streak ${st.streak}   Best ${Math.max(st.best, bestStreak)}`, VIEW.x + 8, VIEW.y + 6);
    line(`Blocked ${st.blocked}/${st.attacks} (${acc}%)   Switch rx ${st.switches ? (st.rxSum / st.switches / 1000).toFixed(2) + 's' : '–'}`, VIEW.x + 8, VIEW.y + 24, '#e8dcc0');
    if (S.paused) line('PAUSED — Space to resume', VIEW.x + 200, VIEW.y + 150, '#ff5a3c');
    // target box on Jad
    if (S.target === 'jad') { hctx.strokeStyle = 'rgba(255,255,0,.85)'; hctx.lineWidth = 2; hctx.strokeRect(JAD_BOX.x, JAD_BOX.y, JAD_BOX.w, JAD_BOX.h); }
    else if (S.running && !S.jadDead) { hctx.strokeStyle = 'rgba(255,255,255,.25)'; hctx.lineWidth = 1; hctx.strokeRect(JAD_BOX.x, JAD_BOX.y, JAD_BOX.w, JAD_BOX.h); }
    if (S.running && !S.jadDead && S.stats.shots === 0) { const blink = Math.floor(performance.now() / 500) % 2; line('← click TzTok-Jad to attack', JAD_BOX.x + JAD_BOX.w + 6, JAD_BOX.y + 40, blink ? '#ffff66' : '#ffb83f'); }
    if (S.running && !S.usedTab) { const show = (k) => (k === 'Escape' ? 'Esc' : k); line(`${show(settings.keyInv)} inventory · ${show(settings.keyPray)} prayer · or click the tabs →`, VIEW.x + 8, VIEW.y + VIEW.h - 46, '#e8dcc0'); }
    // Jad hp
    if (settings.fight === 'healers') {
      const bx = VIEW.x + 10, by = VIEW.y + VIEW.h - 26, bw = 160;
      line(`TzTok-Jad ${Math.max(0, Math.ceil(S.jadHp))}/${JAD_HP}`, bx, by - 16, '#e8dcc0');
      hctx.fillStyle = '#3b0d05'; hctx.fillRect(bx, by, bw, 8);
      hctx.fillStyle = S.jadHp > JAD_HP / 2 ? '#3fbf3f' : '#d43b1c'; hctx.fillRect(bx, by, bw * Math.max(0, S.jadHp) / JAD_HP, 8);
    }
    // healers
    const now = performance.now(), tt = now / 300;
    S.healers.forEach((h) => {
      if (h.state === 'dead') return;
      const [x, y] = h.pos;
      const isTarget = S.target === h;
      if (h.state === 'healing') { hctx.strokeStyle = `rgba(80,255,120,${0.5 + 0.5 * Math.sin(tt + h.i)})`; hctx.lineWidth = 2; hctx.beginPath(); hctx.arc(x, y, 15 + 2 * Math.sin(tt + h.i), 0, Math.PI * 2); hctx.stroke(); }
      if (isTarget) { hctx.strokeStyle = 'rgba(255,255,0,.9)'; hctx.lineWidth = 2; hctx.strokeRect(x - 14, y - 14, 28, 28); }
      hctx.fillStyle = h.state === 'healing' ? '#c2411f' : '#8a3b1c'; hctx.strokeStyle = '#2a0a04'; hctx.lineWidth = 1.5;
      hctx.beginPath(); hctx.arc(x, y, 10, 0, Math.PI * 2); hctx.fill(); hctx.stroke();
      if (h.hp < HEALER_HP) { hctx.fillStyle = '#3b0d05'; hctx.fillRect(x - 14, y + 13, 28, 4); hctx.fillStyle = '#3fbf3f'; hctx.fillRect(x - 14, y + 13, 28 * h.hp / HEALER_HP, 4); }
      hctx.font = '13px "RuneScape Chat", monospace';
      line(h.state === 'healing' ? 'Yt-HurKot · healing Jad' : h.state === 'walking' ? 'Yt-HurKot · coming to you' : 'Yt-HurKot · on you', x - 40, y - 28, h.state === 'healing' ? '#7dff9a' : h.state === 'walking' ? '#ffff66' : '#ffb83f');
      if (h.state !== 'healing') { hctx.strokeStyle = 'rgba(255,184,63,.35)'; hctx.lineWidth = 1; hctx.setLineDash([2, 4]); hctx.beginPath(); hctx.moveTo(x, y); hctx.lineTo(PLAYER_POS[0], PLAYER_POS[1] + 10); hctx.stroke(); hctx.setLineDash([]); }
      hctx.font = '15px "RuneScape Chat", monospace';
    });
    // floating hitsplats on targets
    S.floats = S.floats.filter((f) => f.until > now);
    S.floats.forEach((f) => {
      const age = 1 - (f.until - now) / 1200, y = f.y - age * 14;
      hctx.fillStyle = f.value === 0 ? '#3a5bd9' : '#c8281e'; hctx.beginPath(); hctx.arc(f.x, y, 9, 0, Math.PI * 2); hctx.fill();
      hctx.font = '12px "RuneScape Chat", monospace'; hctx.fillStyle = '#fff'; hctx.textAlign = 'center'; hctx.fillText(String(f.value), f.x, y - 6); hctx.textAlign = 'left';
      hctx.font = '15px "RuneScape Chat", monospace';
    });
    // player attack cooldown pip
    if (S.target) { const w = WEAPONS[settings.weapon]; hctx.fillStyle = 'rgba(255,255,0,.7)'; hctx.fillRect(PLAYER.hpbar[0], PLAYER.hpbar[1] - 5, 58 * (1 - Math.max(0, S.playerCd) / w.speed), 3); }
  }
  let rafId = 0;
  function hudLoop() { drawHud(); rafId = requestAnimationFrame(hudLoop); }

  // ---------- ping: player actions arrive after the connection delay ----------
  const delayed = (fn) => setTimeout(fn, settings.ping);

  // ---------- actions ----------
  function togglePrayer(p) {
    if (!S.running || S.paused) return;
    delayed(() => {
      if (S.pray <= 0) { say('You need to recharge your Prayer at an altar.', true); return; }
      S.prayprot = S.prayprot === p ? 0 : p;
      if (S.attack && !S.attack.checked && S.prayprot === S.attack.style && S.attack.rx == null && S.attack.needSwitch) S.attack.rx = performance.now() - S.attack.start;
      drawTab();
    });
  }
  function drinkSlot(i) {
    if (!S.running || S.paused) return;
    const p = S.potions[i]; if (!(p >= 10 && p <= 13) && !(p >= 20 && p <= 23)) return;
    delayed(() => {
      if (S.potCooldown > 0) return;
      const q = S.potions[i];
      if (q >= 10 && q <= 13) {
        const heal = Math.floor(S.maxHp * 0.15) + 2;
        S.hp = Math.min(S.maxHp + heal, S.hp + heal); S.stats.brews++;
        S.potions[i] = q === 10 ? EMPTY : q - 1; say('You drink some of your Saradomin brew.');
      } else if (q >= 20 && q <= 23) {
        S.pray = Math.min(S.maxPray, S.pray + Math.floor(S.maxPray * 0.25) + 8); S.stats.restores++;
        S.potions[i] = q === 20 ? EMPTY : q - 1; say('You drink some of your super restore potion.');
      } else return;
      playSound('potion'); S.potCooldown = POTION_DELAY; drawTab(); drawOrbs();
    });
  }
  function setTarget(tgt) {
    if (!S.running || S.paused) return;
    delayed(() => { if (tgt === 'jad' ? !S.jadDead : tgt.state !== 'dead') S.target = tgt; });
  }
  function playerAttack() {
    const w = WEAPONS[settings.weapon], tgt = S.target;
    if (!tgt || (tgt !== 'jad' && tgt.state === 'dead') || (tgt === 'jad' && S.jadDead)) { S.target = null; return; }
    S.playerCd = w.speed; S.stats.shots++;
    const vsJad = tgt === 'jad';
    const hit = Math.random() < (vsJad ? w.accJad : w.accHealer);
    const dmg = hit ? 1 + Math.floor(Math.random() * (vsJad ? w.maxJad : w.maxHealer)) : 0;
    if (dmg) S.stats.hits++;
    if (vsJad) {
      if (settings.fight === 'healers') { S.jadHp -= dmg; S.stats.dealt += dmg; }
      S.floats.push({ x: JAD_BOX.x + JAD_BOX.w / 2, y: JAD_BOX.y + JAD_BOX.h / 2, value: dmg, until: performance.now() + 1200 });
      if (settings.fight === 'healers' && S.jadHp <= 0) {
        S.jadHp = 0; S.jadDead = true; S.target = null; S.healers.forEach((h) => { h.state = 'dead'; });
        say('TzTok-Jad has been defeated! You receive a fire cape.', true); clearTimeout(S.attackTimer); setTimeout(() => endFight('won'), 1500);
      }
    } else {
      if (tgt.state === 'healing') { tgt.state = 'walking'; tgt.drawnTick = S.tick; say('The Yt-HurKot stops healing Jad and turns on you.'); if (S.healers.every((h) => h.state !== 'healing')) S.stats.drawMs = performance.now() - S.healersAt; }
      tgt.hp -= dmg; S.stats.dealt += dmg;
      S.floats.push({ x: tgt.pos[0], y: tgt.pos[1], value: dmg, until: performance.now() + 1200 });
      if (tgt.hp <= 0) { tgt.state = 'dead'; S.target = null; say('You kill the Yt-HurKot.'); }
    }
  }
  function playSound(name) { const s = snd[name]; try { s.currentTime = 0; s.play().catch(() => {}); } catch {} }

  // ---------- clicks ----------
  function stageXY(ev) { const r = cvs.getBoundingClientRect(); return [(ev.clientX - r.left) * cvs.width / r.width, (ev.clientY - r.top) * cvs.height / r.height]; }
  cvs.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    const [x, y] = stageXY(ev);
    // tab icons
    if (y > 169 && y < 203 && x > 527 && x < 765) { S.invtab = x >= 697 ? 1 : 0; S.usedTab = true; drawTab(); return; }
    // inventory
    if (S.invtab === 0 && x >= INV.x && x < INV.x + INV.cols * INV.dx && y >= INV.y && y < INV.y + INV.rows * INV.dy) {
      drinkSlot(INV.cols * Math.floor((y - INV.y) / INV.dy) + Math.floor((x - INV.x) / INV.dx)); return;
    }
    // protect prayers
    if (S.invtab === 1 && y >= PRAY_ROW.y && y < PRAY_ROW.y + PRAY_ROW.h && x >= PRAY_ROW.x0 && x < PRAY_ROW.x0 + 3 * PRAY_ROW.dx) {
      togglePrayer(1 + Math.floor((x - PRAY_ROW.x0) / PRAY_ROW.dx)); return;
    }
    // viewport: healers first (small), then Jad
    if (S.running && x < VIEW.x + VIEW.w && y < VIEW.y + VIEW.h) {
      const h = S.healers.find((h) => h.state !== 'dead' && Math.hypot(h.pos[0] - x, h.pos[1] - y) <= 16);
      if (h) { setTarget(h); return; }
      if (x >= JAD_BOX.x && x <= JAD_BOX.x + JAD_BOX.w && y >= JAD_BOX.y && y <= JAD_BOX.y + JAD_BOX.h) setTarget('jad');
    }
  });

  // ---------- keys ----------
  let binding = null;
  document.querySelectorAll('.keybind').forEach((b) => b.addEventListener('click', () => { binding = b; b.classList.add('listening'); b.textContent = '…'; }));
  window.addEventListener('keydown', (e) => {
    const lk = $('lastkey'); if (lk) lk.textContent = `last key: ${e.key === ' ' ? 'Space' : e.key} (code ${e.code})`;
    if (binding) {
      e.preventDefault();
      { const k = e.key.length === 1 ? e.key.toUpperCase() : e.key === ' ' ? 'Space' : e.key; if (binding.dataset.bind === 'inv') settings.keyInv = k; else settings.keyPray = k; binding.textContent = k === 'Escape' ? 'Esc' : k; store.set('settings', settings); }
      binding.classList.remove('listening'); binding = null; return;
    }
    const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    const kk = e.key === ' ' ? 'Space' : k;
    // tab keys work at any time, fight or not, so you can test them from the setup screen
    if (kk === settings.keyInv) { e.preventDefault(); S.invtab = 0; S.usedTab = true; drawTab(); return; }
    if (kk === settings.keyPray) { e.preventDefault(); S.invtab = 1; S.usedTab = true; drawTab(); return; }
    if (e.target.matches && e.target.matches('input, button') && !S.running) return;
    if (S.running && ((e.key === ' ' && settings.keyInv !== 'Space' && settings.keyPray !== 'Space') || k === 'P')) { e.preventDefault(); togglePause(); return; }
    // Esc stops only while it isn't bound to a tab; End always stops
    if (S.running && (e.key === 'End' || (e.key === 'Escape' && settings.keyInv !== 'Escape' && settings.keyPray !== 'Escape'))) { e.preventDefault(); endFight('stopped'); return; }
    if (!S.running && e.key === 'Enter' && !$('setup').hidden) { e.preventDefault(); startFight(); }
  });

  // ---------- Jad ----------
  function launchAttack() {
    const style = Math.random() < 0.5 ? 'magic' : 'ranged';
    const code = STYLE[style];
    const atk = { id: ++S.attackId, style: code, name: style, start: performance.now(), checked: false, rx: null, needSwitch: S.prayprot !== code };
    S.attack = atk; S.cooldown = ATTACK_CYCLE;
    if (!settings.blind) {
      const v = vid[style], o = vid[style === 'magic' ? 'ranged' : 'magic'];
      o.style.zIndex = 1; v.style.zIndex = 2; try { v.currentTime = 0; v.play().catch(() => {}); } catch {}
    }
    if (style === 'magic' || !settings.lateRange) playSound(style);
    S.attackTimer = setTimeout(() => resolveAttack(atk), settings.window);
  }
  function resolveAttack(atk) {
    if (!S.running || atk.id !== S.attackId) return;
    atk.checked = true;
    const st = S.stats; st.attacks++;
    if (atk.needSwitch) { st.switches++; }
    if (atk.name === 'ranged' && settings.lateRange) playSound('ranged');
    if (S.prayprot === atk.style) {
      st.blocked++; st.streak++; st.best = Math.max(st.best, st.streak);
      if (atk.needSwitch && atk.rx != null) { st.rxSum += atk.rx; st.rxBest = st.rxBest == null ? atk.rx : Math.min(st.rxBest, atk.rx); }
      S.splat = { value: 0, style: atk.style, until: performance.now() + 1200 };
    } else {
      st.missed++; st.streak = 0;
      if (atk.needSwitch) st.rxSum += settings.window; // a miss counts as the full window
      const h = Math.floor(Math.random() * (JAD_MAX[atk.name] + 1));
      const dealt = Math.min(h, S.hp); S.hp -= dealt; st.dmg += dealt;
      S.splat = { value: dealt, style: atk.style, until: performance.now() + 1200 };
      say(`Jad's ${atk.name} attack hits you for ${dealt}.`, true);
      drawOrbs();
      if (S.hp <= 0) { S.hp = 0; S.dead = true; say('Oh dear, you are dead!', true); setTimeout(() => endFight('dead'), 1500); }
    }
  }

  // ---------- tick loop ----------
  let tickTimer = 0, nextTickAt = 0;
  function scheduleTick() { const now = performance.now(); nextTickAt = Math.max(nextTickAt + TICK, now + 1); tickTimer = setTimeout(tick, nextTickAt - now); }
  function tick() {
    if (!S.running) return;
    if (!S.paused) {
      S.tick++;
      // prayer drain
      if (S.prayprot) {
        const drain = PROTECT_DRAIN_EFFECT / (2 * settings.bonus + 60);
        S.pray -= drain; S.stats.prayUsed += drain;
        if (S.pray <= 0) { S.pray = 0; S.prayprot = 0; say('You have run out of prayer points; you can recharge at an altar.', true); drawTab(); }
      }
      // hp regen / brew overheal decay
      if (S.tick % HP_REGEN_TICKS === 0) { if (S.hp < S.maxHp) S.hp++; else if (S.hp > S.maxHp) S.hp--; }
      if (S.potCooldown > 0) S.potCooldown--;
      // Jad
      S.cooldown--;
      if (S.cooldown <= 0 && !S.dead && !S.jadDead) launchAttack();
      // you
      if (S.playerCd > 0) S.playerCd--;
      if (S.target && S.playerCd <= 0 && !S.dead) playerAttack();
      // healers
      if (settings.fight === 'healers' && !S.dead && !S.jadDead) {
        if (!S.healersSpawned && S.jadHp <= JAD_HP / 2) {
          S.healersSpawned = true; S.healersAt = performance.now();
          S.healers = HEALER_HOME.map((pos, i) => ({ i, pos: pos.slice(), home: pos, dest: HEALER_DRAWN[i], hp: HEALER_HP, state: 'healing', born: S.tick, drawnTick: 0, nextHit: 0 }));
          say('Four Yt-HurKots appear and rush to heal TzTok-Jad!', true);
        }
        let heal = 0;
        S.healers.forEach((h) => {
          if (h.state === 'healing' && S.tick - h.born >= HEALER_SETTLE_TICKS) heal += HEALER_HEAL;
          if (h.state === 'walking') {
            const f = Math.min(1, (S.tick - h.drawnTick) / HEALER_WALK_TICKS);
            h.pos = [h.home[0] + (h.dest[0] - h.home[0]) * f, h.home[1] + (h.dest[1] - h.home[1]) * f];
            if (f >= 1) { h.state = 'attacking'; h.nextHit = S.tick + 1; say('The Yt-HurKot is on you now — it stays on you until it dies.'); }
          }
          if (h.state === 'attacking' && S.tick >= h.nextHit) {
            h.nextHit = S.tick + HEALER_SPEED;
            const dmg = S.prayprot === 3 || Math.random() > HEALER_ACC ? 0 : Math.floor(Math.random() * (HEALER_MAX + 1));
            const dealt = Math.min(dmg, S.hp); S.hp -= dealt; S.stats.dmg += dealt; S.stats.healerDmg += dealt;
            S.splat = { value: dealt, style: 3, until: performance.now() + 900 };
            if (S.hp <= 0) { S.hp = 0; S.dead = true; say('Oh dear, you are dead!', true); setTimeout(() => endFight('dead'), 1500); }
          }
        });
        if (heal) {
          const amt = Math.min(JAD_HP - S.jadHp, heal); S.jadHp += amt; S.stats.healed += amt;
          if (S.jadHp >= JAD_HP && S.healers.some((h) => h.state === 'dead')) {
            S.healers.forEach((h) => { if (h.state === 'dead') { h.state = 'healing'; h.hp = HEALER_HP; h.pos = h.home.slice(); h.born = S.tick; } });
            say('TzTok-Jad is back to full health — the Yt-HurKots return!', true);
          }
        }
      }
      drawOrbs();
    }
    scheduleTick();
  }

  // ---------- fight lifecycle ----------
  function startFight() {
    readForm(); setVolume(settings.volume); resetState();
    S.running = true; S.startedAt = performance.now(); S.invtab = 1; S.target = null;
    $('setup').hidden = true; $('summary').hidden = true; $('stopfight').hidden = false; $('pausehint').hidden = false;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    Object.values(vid).forEach((v) => { v.style.visibility = settings.blind ? 'hidden' : 'visible'; v.style.zIndex = 1; try { v.pause(); v.currentTime = 0; } catch {} });
    say(settings.fight === 'healers' ? 'TzTok-Jad: This is going to hurt... Click him to attack.' : 'Practice mode: Jad attacks every 4.8 s until you stop. Click him to shoot back.');
    drawAll(); nextTickAt = performance.now(); scheduleTick(); cancelAnimationFrame(rafId); hudLoop();
  }
  function togglePause() {
    if (!S.running) return;
    S.paused = !S.paused;
    if (S.paused) { S.pauseStart = performance.now(); clearTimeout(S.attackTimer); Object.values(vid).forEach((v) => v.pause()); }
    else {
      S.pausedMs += performance.now() - S.pauseStart;
      if (S.attack && !S.attack.checked) { const left = Math.max(50, settings.window - (S.pauseStart - S.attack.start)); S.attack.start = performance.now() - (settings.window - left); S.attackTimer = setTimeout(() => resolveAttack(S.attack), left); }
    }
  }
  function endFight(reason) {
    if (!S.running) return;
    S.running = false; S.paused = false; clearTimeout(tickTimer); clearTimeout(S.attackTimer);
    Object.values(vid).forEach((v) => { try { v.pause(); } catch {} });
    cancelAnimationFrame(rafId); drawHud();
    $('stopfight').hidden = true; $('pausehint').hidden = true;
    const st = S.stats; st.best = Math.max(st.best, st.streak);
    if (st.best > bestStreak) { bestStreak = st.best; store.set('bestStreak', bestStreak); }
    const dur = (performance.now() - S.startedAt - S.pausedMs) / 1000;
    const acc = st.attacks ? Math.round(st.blocked / st.attacks * 100) : 0;
    const title = { won: 'TzTok-Jad defeated — fire cape!', dead: 'Oh dear, you are dead.', stopped: 'Fight stopped' }[reason];
    const sub = { won: 'Healers tagged and Jad down. That is the whole fight.', dead: 'Prayer before damage, one heal per attack. Go again.', stopped: `${st.attacks} attacks over ${dur.toFixed(0)} s.` }[reason];
    $('summary-title').textContent = title; $('summary-sub').textContent = sub;
    const rows = [
      ['Attacks blocked', `<span class="big">${st.blocked} / ${st.attacks}</span> (${acc}%)`],
      ['Switches needed', st.switches],
      ['Avg reaction on switches', st.switches ? (st.rxSum / st.switches / 1000).toFixed(2) + ' s' : '–'],
      ['Fastest switch', st.rxBest != null ? (st.rxBest / 1000).toFixed(2) + ' s' : '–'],
      ['Best streak', `${st.best}${st.best >= bestStreak && st.best > 0 ? ' (personal best)' : ''}`],
      ['Damage taken', st.dmg],
      ['Brews / restores', `${st.brews} / ${st.restores}`],
      ['Prayer points used', Math.round(st.prayUsed)],
    ];
    rows.push(['Damage dealt', `${st.dealt} (${st.hits}/${st.shots} hits)`]);
    if (settings.fight === 'healers') {
      rows.push(['Healers drawn in', st.drawMs != null ? (st.drawMs / 1000).toFixed(1) + ' s' : S.healersSpawned ? 'not all drawn' : '–']);
      rows.push(['Jad healed by Yt-HurKots', Math.round(st.healed)]);
      rows.push(['Damage from healers', st.healerDmg]);
    }
    rows.push(['Duration', `${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, '0')}`]);
    $('summary-body').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    $('summary').hidden = false; $('bestline').textContent = bestStreak ? `Best streak: ${bestStreak}` : '';
  }
  $('startfight').addEventListener('click', startFight);
  $('stopfight').addEventListener('click', () => endFight('stopped'));
  $('again').addEventListener('click', startFight);
  $('tosetup').addEventListener('click', () => { $('summary').hidden = true; $('setup').hidden = false; });
  $('volrange').addEventListener('input', (e) => { settings.volume = Number(e.target.value); setVolume(settings.volume); store.set('settings', settings); });

  // ---------- stage scaling ----------
  function fit() {
    const s = Math.min(window.innerWidth / 765, window.innerHeight / 503, 2.2);
    $('stage').style.transform = `scale(${s})`;
  }
  window.addEventListener('resize', fit);

  // ---------- boot ----------
  applySettingsToForm(); setVolume(settings.volume); resetState(); fit();
  let pending = Object.keys(img).length;
  Object.values(img).forEach((im) => { im.onload = () => { if (--pending === 0) drawAll(); }; if (im.complete && im.naturalWidth) im.onload(); });
  say('Set up your fight and press Start (or Enter).');
  // debug / tooling hook: live state and settings (read-only by convention)
  window.jadsim = { state: S, settings, togglePrayer, drinkSlot, togglePause, endFight, setTarget };
})();
