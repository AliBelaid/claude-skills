---
name: ultrathink
description: Deeper, slower reasoning for hard questions. Use when the user writes "ultrathink", "think hard", "ultra think", or asks for a careful analysis of a tricky bug, architecture or trade-off, a risky change, or an answer they can rely on. Works in explicit stages, tests each assumption against evidence, and states uncertainty instead of guessing.
---

# UltraThink — careful reasoning on hard problems

This is a working method, not a promise of extra hidden effort. Spend the extra care on the
steps below and show the result, not a transcript of every thought.

## When to use it
- The user says "ultrathink", "think hard", or asks for a careful or reliable answer.
- A bug has resisted one or two quick attempts.
- The decision is hard to undo (data, production, money, security, a public release).
- Two or more plausible answers disagree.

Skip it for simple lookups and small edits. Extra process on an easy task is noise.

## Method
1. **Restate.** Write the question in one sentence, and what a correct answer must satisfy.
2. **Assumptions.** List what you are assuming. Mark each one *verified* (you read it, ran it, or the user said it) or *unverified*.
3. **Hypotheses.** Give at least three plausible explanations or approaches. Do not stop at the first.
4. **Eliminate with evidence.** For each hypothesis, name the most specific piece of evidence that would rule it in or out (an exact error, a log line, a line of code, a failing input). Gather that evidence before concluding: read the file, run the command, check the log.
5. **Decide.** Pick the answer. State the trade-offs and the one fact that would change your mind.
6. **Verify.** Check the answer against the original requirement and against anything else it touches (other services, data, users). If you could not verify something, say so.

## Output
- Lead with the answer and how sure you are (high / medium / low, and why).
- Then the evidence that supports it, in a few lines.
- Then open items: what is unverified, and what to check next.
- Keep it short. A tight answer with verified facts beats a long one with guesses.

## Rules
- Never present an unverified assumption as a fact.
- Never claim a test passed, or a fix works, unless you ran it and saw the result.
- If the evidence contradicts your favourite hypothesis, drop it and say so.
- If the question cannot be settled from here, say what would settle it and who or what can provide it.
