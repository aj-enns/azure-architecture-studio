# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/aj-enns/azure-architecture-review/security/advisories/new).
Do not include credentials, customer data, or exploit details in a public issue.

Include the affected commit or version, reproduction steps, impact, and any known
mitigations. You should receive an acknowledgement within three business days.

## Supported versions

This project is in active early development. Security fixes are applied to the
latest commit on `main`; older commits and forks are not maintained.

## Deployment responsibility

Local development is unauthenticated. The provided Azure deployment requires
Microsoft Entra sign-in and the API enforces request throttling. Custom deployments
must preserve an authentication boundary and keep provider credentials server-side.
