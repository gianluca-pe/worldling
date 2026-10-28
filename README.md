# Worldling

An original, mobile-first terrain-shaping strategy game inspired by the indirect control of the 1989 classic. Grow the blue settlement, shape the island, and outlast the red rival in one deterministic skirmish.

## Run locally

Requires Node.js 24 or newer.

```sh
npm ci
npm run dev
```

For the production version:

```sh
npm run build
npm run preview -- --host 0.0.0.0
```

## Controls

- **Touch:** drag to pan, pinch to zoom, and tap to apply the selected tool.
- **Mouse:** drag to pan in Inspect mode; drag to paint terrain with Raise/Lower.
- **Keyboard:** arrow keys pan, WASD moves the tile cursor, Enter applies the tool, and 1–6 select tools.
- **Home** centers your settlement. **Help** reopens the guide.

Raise/Lower costs 3 mana, or 5 when raising from sea. Rally gathers settlers. Earthquake and Flood attack after a five-second warning. Full houses trigger expansion; housed settlers generate the most mana.

A fresh visit generates a random island. Open the **Island seed** label to enter a 1–8 character hexadecimal seed or choose **New island**. Restart replays the current seed from its original state. A `?seed=474F44` URL also recreates a specific island.

The current match and guide preference are stored locally in the browser. Reload resumes the island deterministically; starting another island clears the previous saved match. If storage is unavailable, the game remains playable without persistence.

## Verify

```sh
npm run check
npm run test:e2e
npm run build
```

Additional repeatable investigations:

```sh
npm run scenario
npm run balance
# With a production preview running on port 4173:
npm run profile
```

The source distribution includes the complete unit and browser test suites. Browser tests cover desktop and phone-sized Chromium and WebKit; they are not a substitute for physical-device, accessibility, fresh-player, or fun/balance validation.

## Publish

Upload the **contents of `dist/`** to any static web host. No backend, environment variables, accounts in the game, or external assets are required. Configure the host to serve `index.html` at the site root and the generated `assets/` directory as static files.

The game uses original code and procedural artwork.
