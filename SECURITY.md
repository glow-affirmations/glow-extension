# Security policy

## Supported version

Security fixes are provided for the latest released version of the extension.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Email
[support@justglow.dev](mailto:support@justglow.dev) with:

- the affected version and feature;
- reproduction steps or a minimal proof of concept;
- the expected and observed impact; and
- any suggested remediation or disclosure deadline.

Do not include real user data, access tokens, private keys, or credentials.
Please allow a reasonable period for investigation and remediation before
public disclosure.

The public client must be treated as hostile. A publishable Supabase key and
first-party API locations are not secrets; service-role keys, private provider
configuration, and privileged backend implementation do not belong in this
repository. Authorization must be enforced by RLS or first-party server code,
not by extension UI state.
