# Gym Check

Visualize your training progress from the [Hevy](https://www.hevyapp.com) CSV export: key figures, progress per
exercise, sets per muscle group and an estimate of muscle gained. A static web app that runs entirely in your browser.

**Open the app: <https://bobtale.github.io/gym-check/>**

## Disclaimer

Gym Check is an independent hobby project. It is not affiliated with, endorsed by or connected to Hevy or its makers
in any way. It does not use Hevy's API, servers or app; it only reads the CSV file you export yourself with Hevy's
built-in export feature. "Hevy" is a trademark of its respective owner and is mentioned only to describe the supported
file format.

The muscle gain figure is an estimate based on published training models, not a measurement.

## Usage

1. In Hevy: Profile → Settings → Export data → Export workouts (CSV).
2. Open the app in Chrome on Android and choose "Install app" or "Add to Home screen" from the menu.
3. Tap "CSV auswählen" and pick the exported file. On desktop you can also drag the file into the window.

The data stays stored on the device until you remove it with "Daten löschen". Import a fresh export to update it.

## Privacy

Your data never leaves your device: no server, no upload, no tracking, no third-party requests. All files, including
Chart.js, are served from GitHub Pages, which processes technically necessary access data such as IP addresses (see the
[GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)).

## License

[MIT](LICENSE)

`vendor/chart.umd.min.js` is [Chart.js](https://www.chartjs.org) 4.5.1, © Chart.js Contributors, MIT License.

The visual effects in `effects.js` and the related rules in `style.css` are vanilla ports of components from
[React Bits](https://reactbits.dev) (PillNav, CountUp, SpotlightCard, GradientText, AnimatedContent, StarBorder)
by David Haz and remain under their license, MIT + Commons Clause, Copyright (c) 2026 David Haz: see
[LICENSE-react-bits.md](LICENSE-react-bits.md).
