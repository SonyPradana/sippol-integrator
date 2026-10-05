# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-05

First release. A one-shot command that logs in, opens one period's page, and
clicks send exactly once.

### Added

- `app auth`, a read-only pre-flight that reports whether the login was accepted.
  It judges by the URL before and after submit, not by the login field, because
  an app can keep a login form in its layout on every page.
- `app --dry-run`, which reports the URL, every input the server rendered, and
  the send button's state without clicking anything.
- `--json` for machine-readable output on stdout while the log file stays human.
- `app help`, resolved before the config load so it works with no `.env`.
- A lock file, so a scheduler cannot start a second run and click twice.
- Daily UTC log files under `logs/`.
- Standalone executables from `bun run compile` and `bun run compile:linux`.

### Behaviour worth knowing

- Success is the navigation the page performs after the send, never the alert.
  The alert also fires on failure, and its text is kept because that string is
  how the page explains a refusal.
- A synchronous `alert()` freezes the page's JS thread, so `click()` would never
  return. The click is raced against the dialog event instead. A click that
  neither returns nor opens a dialog within 30 seconds is reported as
  `click-hung`, which means the outcome is unknown, not that nothing happened.
