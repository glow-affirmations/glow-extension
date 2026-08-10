# Public client security boundary

This repository contains code that runs on a user's device. Its source,
network requests, bundled configuration, and local state must all be treated as
public and attacker-controlled.

## Public by design

The extension contains a Supabase project URL, a publishable client key, public
OAuth metadata, first-party API locations, Realtime topic formats, and the
database/RPC names required by the client. Supabase publishable keys are
intended for public applications and do not grant privileged backend access.

## Authorization boundary

The extension UI never constitutes authorization. Connected features require a
user access token, and authorization is enforced outside this repository:

- direct database access is constrained by grants and Row Level Security;
- aggregate views run with invoker security and inherit underlying RLS;
- listening synchronization executes as the authenticated caller;
- generated-audio reads are constrained to audio visible to the authenticated
  owner;
- Realtime chat uses authenticated private channels; and
- community, checkout, generation, moderation, and billing mutations are
  validated by first-party server code.

Premium state displayed by the extension is a convenience for the interface.
The server independently verifies entitlement for Premium operations.

## Deliberately private

This repository does not contain database migrations, privileged keys, backend
service clients, payment-provider credentials, private operational details, or
the content-generation pipeline. Removing those files from this repository is
not itself a security control; the services are designed to reject unauthorized
requests from a modified client.

## Review evidence for 0.1.4

Before the 0.1.4 public release, the live client-facing relations, aggregate
views, listening RPC, generated-audio Storage policy, authenticated Realtime
policy, and first-party API guards were reviewed against the current Supabase
security guidance. No critical or high-severity client-boundary finding was
identified. This review must be repeated when a new direct data surface or
privileged operation is added.

Report suspected authorization bypasses privately as described in
[SECURITY.md](../SECURITY.md).
