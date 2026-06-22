# Frontend gotchas (React / Vite / UI)

## React StrictMode silently drops state updates if the updater is impure

StrictMode (dev) **double-invokes** state updater functions to surface
impurities. If you mutate a ref or generate an id *inside* `setState`, the second
invocation sees the mutated ref and produces a different (wrong) result —
messages vanish with no error.

Bad (this dropped every transcript message):

```ts
setMessages((prev) => {
  const id = idMapRef.current[key];          // ref read
  if (id) return prev.map(...);              // 2nd pass takes this branch on a
  const newId = uid();                       // prev that never had the message
  idMapRef.current[key] = newId;             // ref MUTATION inside updater
  return [...prev, { id: newId, ... }];
});
```

Good — pure updater, id derived from a stable key, no side effects inside:

```ts
setMessages((prev) => {
  const idx = prev.findIndex((m) => m.id === key);
  if (idx >= 0) { const next = prev.slice(); next[idx] = {...prev[idx], ...}; return next; }
  return [...prev, { id: key, ... }];        // `key` is the stable realtime item id
});
```

Anything impure (ref writes, id minting, ordering counters) must happen
**before** `setState`, not inside the updater.

## `console.debug` is invisible by default

Chrome hides the "Verbose" log level by default, so `console.debug` looks like
"nothing is happening." Use `console.log` for diagnostics.

## Transcript order

See `.opencode/docs/realtime-voice.md` → "Transcript ordering". Sort by a
conversation sequence index, not `createdAt`.

## UI conventions (match what exists — don't redesign)

- **Voice-only chat**: one mic button (`Talk`/`Stop`) + the live transcript.
  No text input, no Send button.
- **Flat**: card background `rgba(2,6,23,0.35)`, border `rgba(148,163,184,0.22)`.
  No gradient fills or drop shadows on buttons or message bubbles.
- Panel titles share one style (e.g. `fontSize: 14, fontWeight: 750`). When you
  add a panel, match its siblings.
- No code comments unless asked.

## Verifying frontend changes

`npx tsc -b` type-checks; `npx vite build` catches import/runtime issues. Run
both before claiming done.
