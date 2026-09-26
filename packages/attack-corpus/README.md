# @bonded/attack-corpus

Runs the same prompt-injection attack against a deliberately unprotected
"naive agent" and against Bonded's real `enforce()`, side by side. This is
not part of the product -- the enforcer itself makes zero LLM calls by
design (see `packages/enforcer`). This package exists only to generate the
comparison evidence for `/corpus`.

## Naive-agent LLM providers

The naive-agent harness (`harness/naive-agent-claude.ts`) needs an LLM to
play the unprotected agent. It tries providers in this order, using
whichever key is set:

| Order | Provider | Env var | Notes |
|---|---|---|---|
| 1 | Anthropic | `ANTHROPIC_API_KEY` | Native Messages API |
| 2 | Groq | `GROQ_API_KEY` | Free tier, OpenAI-compatible, fast Llama/Mixtral inference |
| 3 | OpenRouter | `OPENROUTER_API_KEY` | Free tier, OpenAI-compatible, aggregates many `:free` open models |

Set any **one** of these and `pnpm --filter @bonded/attack-corpus run-naive-agent`
will use it. If the first configured provider's call fails (no credit, rate
limit, retired model), the harness logs why and automatically retries the
same task against the next configured provider -- the demo isn't hostage to
any single vendor's account state.

Groq and OpenRouter both offer free-tier signup with no card required as of
this writing; either is sufficient to run this harness, since the task
(decide whether to call `approve_unlimited` after reading an injected
string) does not require a frontier-scale model.

Model names for the two fallback providers are overridable via `GROQ_MODEL`
/ `OPENROUTER_MODEL`, because both providers' free-model catalogs change
over time. If a default 404s, check the provider's current model list
rather than editing the code.

## Running it

```bash
pnpm --filter @bonded/attack-corpus run-naive-agent   # the unprotected side
pnpm --filter @bonded/attack-corpus run-harness        # the real enforce() side
```

Both append to `results.json`, which `/corpus` reads directly -- the number
shown there is never hand-typed.
