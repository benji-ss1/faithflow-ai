/**
 * OpenFlow structured-output parser — pure contract tests.
 * Run: npx tsx --test test/openflow-parse.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOpenFlowCard } from "../src/lib/openflow/parse";

test("plain chat text yields prose and no card", () => {
  const { prose, card } = extractOpenFlowCard("Here is some help with your service.");
  assert.equal(card, null);
  assert.equal(prose, "Here is some help with your service.");
});

test("service_plan parses blocks, total, insights; prose stripped of the tag", () => {
  const raw = 'Here is a plan.\n<service_plan>{"serviceType":"Convention","blocks":[{"name":"Praise & Worship","durationMin":35,"type":"songs","items":["Waymaker","Great Is Thy Faithfulness"]},{"name":"The Word","durationMin":40,"type":"sermon","items":["Pastor Samuel"]}],"insights":["Runs long here."]}</service_plan>';
  const { prose, card } = extractOpenFlowCard(raw);
  assert.equal(prose, "Here is a plan.");
  assert.ok(card && card.kind === "service_plan");
  if (card.kind !== "service_plan") return;
  assert.equal(card.data.serviceType, "Convention");
  assert.equal(card.data.blocks.length, 2);
  assert.equal(card.data.blocks[0].type, "songs");
  assert.deepEqual(card.data.blocks[0].items, ["Waymaker", "Great Is Thy Faithfulness"]);
  assert.equal(card.data.totalMin, 75); // summed when not supplied
  assert.deepEqual(card.data.insights, ["Runs long here."]);
});

test("scripture yields the reference only (never verse text)", () => {
  const { card } = extractOpenFlowCard('Sure.\n<scripture>{"reference":"Romans 8:28","translation":"KJV"}</scripture>');
  assert.ok(card && card.kind === "scripture");
  if (card.kind !== "scripture") return;
  assert.equal(card.data.reference, "Romans 8:28");
  assert.equal(card.data.translation, "KJV");
});

test("song_suggestions parses a list; empty list is not a card", () => {
  const ok = extractOpenFlowCard('<song_suggestions>{"suggestions":[{"title":"Waymaker","author":"Sinach","reason":"grace theme"}]}</song_suggestions>');
  assert.ok(ok.card && ok.card.kind === "song_suggestions");
  const empty = extractOpenFlowCard('<song_suggestions>{"suggestions":[]}</song_suggestions>');
  assert.equal(empty.card, null);
});

test("a still-streaming (unclosed) tag never flashes a card; prose before it shows", () => {
  const { prose, card } = extractOpenFlowCard('One moment.\n<service_plan>{"serviceType":"Conv');
  assert.equal(card, null);
  assert.equal(prose, "One moment.");
});

test("malformed JSON in a closed tag degrades to no card, keeps prose", () => {
  const { prose, card } = extractOpenFlowCard('Here.\n<scripture>{not json}</scripture>');
  assert.equal(card, null);
  assert.equal(prose, "Here.");
});
