# Security Policy

## Supported versions

Only the latest release is supported.

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately via [GitHub Security Advisories](https://github.com/jpinhel/wc-devtools/security/advisories/new). You should get a response within a week.

## Scope notes

The extension injects a script into inspected pages (`world: MAIN`) and renders page-provided data inside the DevTools panel. The interesting attack surface is therefore:

- a malicious inspected page influencing the panel (data is serialized to JSON-safe values and rendered through Lit templates; values interpolated into `style` attributes are validated),
- forged `postMessage` commands from page scripts (equivalent to actions a developer with DevTools open could already perform — see the security note in `entrypoints/content.ts`).

Reports on either surface are very welcome.
