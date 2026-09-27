import assert from "node:assert/strict";
import test from "node:test";
import { isNearDuplicatePrompt } from "../lib/problem-quality.ts";

test("duplicate guard normalizes formatting and numeric variants", () => {
  const recent = "Prove that every bounded sequence in R has a convergent subsequence.";
  assert.equal(isNearDuplicatePrompt("Prove that every bounded sequence in $\\mathbb{R}$ has a convergent subsequence!", [recent]), true);
  assert.equal(isNearDuplicatePrompt("For f(x)=x^2, compute f'(3).", ["For f(x)=x^2, compute f'(4)."]), true);
});

test("duplicate guard catches a close wording change but allows a different task", () => {
  const recent = "Prove that every bounded sequence in R has a convergent subsequence using the Bolzano Weierstrass theorem.";
  assert.equal(isNearDuplicatePrompt("Show that every bounded sequence in R has a convergent subsequence using the Bolzano Weierstrass theorem.", [recent]), true);
  assert.equal(isNearDuplicatePrompt("Construct a sequence of rational numbers that converges to an irrational real number and justify its limit.", [recent]), false);
});
