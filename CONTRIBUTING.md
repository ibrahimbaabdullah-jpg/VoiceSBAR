# Contributing

Thanks for helping! Bug reports, translations (especially an Arabic interface), and fixes are welcome.

1. Fork the repository and create a branch.
2. `npm install`, then work locally with `npm run mock:providers` and `npm run preview` (see the README). No API
   keys are needed.
3. Add or update tests next to the code you change: `tests/server` for the API, `tests/web` for the UI.
4. Run `npm run check` (lint, typecheck, tests and build). CI runs the same on Linux, macOS and Windows.
5. Open a pull request describing what changed and how you tested it. For UI changes, include a screenshot.

Guidelines:

- Never commit secrets. `.dev.vars` is git-ignored; keep it that way.
- Keep the server free of transcripts and audio. Usage records hold numbers only.
- Anything that can cost money (new provider calls, new parameters) needs a limit and a test.
- Keep the interface simple for non-technical users, and check right-to-left text.
- Schema changes go in a new numbered file in `migrations/`; never edit an applied migration.

By contributing you agree that your contributions are licensed under the MIT License.
