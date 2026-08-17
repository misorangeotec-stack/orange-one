# `mywork/items` — the rules, written once

Each file here answers one question for one module:

> given this module's data and a user, which rows are that person's work, and what
> does each one say?

That is all a provider ever did inside its `useMemo`. It is now here instead, as a
plain function, for one reason:

**Two readers need the same answer.**

| Reader | How it runs |
|---|---|
| My Work Today | in the browser, when someone opens the page |
| The daily snapshot email | on the server at 9am, with nobody watching |

The email cannot borrow the browser's copy — there is no browser at 9am — so for a
while the rules existed twice: once in `providers/`, once in
`supabase/worksnapshot/entry.ts`. They agreed because they were copied carefully
and checked against real screens. That is not a property that survives six months
of edits: change a rule in one place, forget the other, and the mail and the screen
start disagreeing about the same person. That has already happened once, and cost a
day to find.

So the rule lives here, and both read it.

## Rules for this folder

- **Stay pure.** No React, no hooks, no Supabase client, no `import.meta.env`, no
  `window`. The server bundles these files directly
  (`supabase/worksnapshot/build.mjs`) and its build fails loudly if anything
  browser-only creeps into the import graph.
- **Take data in, return `WorkItem[]`.** Fetching stays in the provider; deciding
  stays here.
- **Never bucket.** `dueIso` goes out raw. `MyWorkToday` buckets once, with
  `shared/lib/dueBuckets`, because the definition of "overdue" must exist once too.
- **A provider must contain no filtering logic.** If you find yourself adding a
  condition in `providers/`, it belongs here — otherwise the email will not have it.

## Adding a module

1. Write `items/<name>.ts` exporting one function.
2. Call it from `providers/<name>.ts`.
3. Add its `appId` to `COVERED_APP_IDS` in `supabase/worksnapshot/entry.ts` and
   call it there.

Step 3 is not optional and not on the honour system: the bundle build reads
`registry.ts` and refuses to build if a registered provider is missing from that
list.
