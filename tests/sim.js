#!/usr/bin/env node
/*
 * AI-vs-AI simulation: plays many games and checks engine invariants.
 * Usage: node tests/sim.js [games]
 */
'use strict';

const path = require('path');
const S = require(path.join(__dirname, '..', 'engine.js'));
const { AI } = require(path.join(__dirname, '..', 'ai.js'));
const { SIZE, SHOT, CARD_ORDER, DECK_SIZE, idx } = S;

const GAMES = Number(process.argv[2]) || 400;

function checkInvariants(g) {
  const problems = [];
  if (g.cardCount() !== DECK_SIZE) problems.push(`card count ${g.cardCount()} != ${DECK_SIZE}`);
  g.hands.forEach((h, p) => { if (h.length > S.DECK.handMax) problems.push(`hand ${p} over max: ${h.length}`); });
  // Single-use cards must never come back into the deck once played.
  S.SINGLE_USE.forEach((k) => {
    const played = g.__playedSingle ? g.__playedSingle[k] || 0 : 0;
    const inDeck = g.deck.filter((d) => d === k).length;
    if (inDeck > S.copiesOf(k) - played) problems.push(`single-use ${k} came back into the deck`);
  });
  if (g.deck.includes('cargoload') || g.discard.includes('cargoload')) problems.push('locked cargo leaked into deck/discard');
  g.hands.forEach((h, p) => {
    if (h.filter((k) => k === 'cargoload').length !== g.cargo[p].length) problems.push(`cargo timers out of sync for ${p}`);
  });
  g.boards.forEach((b, p) => {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const k = idx(r, c);
      const st = b.shots[k];
      const at = b.segment(r, c);
      if (st === SHOT.MISS && at) problems.push(`board ${p}: miss marker on ship at ${r},${c}`);
      if (st === SHOT.HIT && (!at || !b.ships[at.ship].damage[at.seg])) problems.push(`board ${p}: hit marker on undamaged/empty cell ${r},${c}`);
      if (st === SHOT.BLOCKED && !at) problems.push(`board ${p}: blocked marker on empty cell ${r},${c}`);
      if (st === SHOT.SPOTTED && !at) problems.push(`board ${p}: spotted marker on empty cell ${r},${c}`);
    }
    b.mines.filter((m) => m.active).forEach((m) => m.cells.forEach(([r, c]) => {
      if (b.shipAt(r, c) !== -1) problems.push(`board ${p}: mine under a ship at ${r},${c}`);
    }));
    b.ships.forEach((s, i) => {
      if (s.cells.length !== s.size) problems.push(`board ${p}: ship ${s.name} has ${s.cells.length} cells`);
      if (b.isSunk(i) && !s.cells.every(([r, c]) => b.shotAt(r, c) === SHOT.HIT)) problems.push(`board ${p}: sunk ${s.name} not fully revealed`);
    });
  });
  return problems;
}

const wins = [0, 0];
const turns = [];
const played = Object.fromEntries(CARD_ORDER.map((k) => [k, 0]));
let rejected = 0, unfinished = 0, invariantFailures = 0, ends = 0;
const sampleErrors = [];

for (let n = 0; n < GAMES; n++) {
  const g = new S.Game();
  g.boards[0].randomize();
  g.boards[1].randomize();
  const ais = [new AI(g, 0), new AI(g, 1)];
  g.start(n % 2);
  const sunkBefore = new Set();

  let steps = 0;
  while (g.phase === 'battle' && steps < 3000) {
    const res = ais[g.turn].act();
    steps++;
    if (!res.ok) {
      rejected++;
      if (sampleErrors.length < 5) sampleErrors.push(`${res.reason} :: ${JSON.stringify(res.action)}`);
      break;
    }
    if (res.action.kind === 'card') played[res.action.card]++;
    if (res.action.kind === 'card' && S.SINGLE_USE.includes(res.action.card)) {
      g.__playedSingle = g.__playedSingle || {};
      g.__playedSingle[res.action.card] = (g.__playedSingle[res.action.card] || 0) + 1;
    }
    if (res.action.kind === 'end') ends++;

    const problems = checkInvariants(g);
    // A sunk ship must stay sunk.
    g.boards.forEach((b, p) => b.ships.forEach((s, i) => {
      const key = `${p}:${s.id}`;
      if (b.isSunk(i)) sunkBefore.add(key);
      else if (sunkBefore.has(key)) problems.push(`board ${p}: ${s.name} un-sank`);
    }));
    if (problems.length) {
      invariantFailures++;
      if (sampleErrors.length < 5) sampleErrors.push(`after ${JSON.stringify(res.action)}: ${problems[0]}`);
      break;
    }
  }
  if (g.phase !== 'over') { unfinished++; continue; }
  wins[g.winner]++;
  turns.push(g.turnNumber);
}

turns.sort((a, b) => a - b);
const neverPlayed = CARD_ORDER.filter((k) => played[k] === 0);
console.log(`games: ${GAMES}, finished: ${turns.length}, wins: P0 ${wins[0]} / P1 ${wins[1]}`);
console.log(`turns (both sides): median ${turns[turns.length >> 1]}, min ${turns[0]}, max ${turns[turns.length - 1]}`);
console.log('cards played:', played);
console.log('turns skipped by Software Bug:', ends);
if (sampleErrors.length) console.log('sample errors:\n  ' + sampleErrors.join('\n  '));

const ok = rejected === 0 && unfinished === 0 && invariantFailures === 0 && neverPlayed.length === 0;
console.log(ok ? 'PASS' : `FAIL (rejected ${rejected}, unfinished ${unfinished}, invariant failures ${invariantFailures}, never played: ${neverPlayed.join(', ') || 'none'})`);
process.exit(ok ? 0 : 1);
