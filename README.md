# Sidespin

A two-player pool game with private room codes, a solo practice table, and an authoritative Node.js server. The interface is plain HTML, CSS, and JavaScript; the table and wooden cue are rendered with Canvas. No accounts, API keys, database, or external asset services are required.

## Run locally

Requires **Node.js 22+** (a version is pinned in `.node-version`).

```bash
npm ci
npm start
```

Open `http://localhost:3000` in your browser. `npm run dev` restarts the server when server files change. The server listens on `0.0.0.0` and uses `PORT` if set, otherwise `3000`.

To play together, enter a nickname, create a room, and copy the invite to a friend. The friend can follow the link or enter the six-character code. Both players click **I’m ready** to begin. When developing on one computer, use two tabs or browser windows; seats are stored per tab, while your nickname is remembered across visits. For separate devices, both must reach the same hosted server.

## Controls

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Aim | Click/tap the cloth to aim at a point | Focus the table, then Left/Right; hold Shift for finer adjustments |
| Rotate the cue | Grab the wooden cue and drag it around the white ball | Left/Right on the table |
| Set power and shoot | Grab the power handle, pull **down**, then release; distance pulled sets power | Focus the power control: Down increases, Up decreases, Home/End select minimum/maximum, Space/Enter shoot |
| Shoot at the displayed power | Click **Shoot** | Space on the table |
| Add spin | Move the red dot on the cue-ball control | Focus the spin ball, then use the arrow keys |
| Reset spin | Click the reset arrow | Home on the spin ball |
| Place the white after a foul | Click/tap an unoccupied point on the cloth | — |

The cue pivots around the white; it cannot move the white except during ball in hand. Pulling the power control moves the cue backwards before the striking animation. If a drag is cancelled, it does not shoot. A simple tap on the power control also does not shoot.

Top spin follows the object ball; bottom spin draws back; side spin changes cushion rebounds and adds collision throw. The aim guide shows the first contact and approximate object-ball direction, rather than predicting a complete shot. Sound and the guide can be toggled.

## House rules

- The room creator plays reds and breaks. The other player plays yellows. Colours are assigned immediately, with no open-table phase.
- A legal pot of your colour gives another shot. A legal shot without a pot passes the turn.
- The first object ball you contact must be your colour, or the black when all seven of your colours were already cleared **before this shot**. Later contacts may involve either colour.
- Missing every ball, hitting the wrong group first, or potting the white is a foul. After contact, a ball must reach a cushion or a pocket. A foul gives the other player ball in hand anywhere on clear cloth.
- Potted colours remain down after fouls. Potting only an opponent’s colour passes the turn; it is not itself a foul after a legal first contact.
- Pot the black legally after clearing all seven colours to win. Potting it early, on the same shot as your final colour, or while fouling loses the frame.
- Both players must request a rematch. The rematch swaps colours and the opening break.
- Practice uses the same red-then-black rules. After a foul you place the white and continue; potting the black early ends the practice frame.

These are the app’s consistent house rules, rather than a complete implementation of any tournament rulebook.

## Physics and multiplayer

The server runs a fixed 60 Hz simulation with 240 Hz collision substeps, and sends authoritative state at up to 30 Hz. Clients smooth those snapshots; they send aim, spin, power, and placement requests rather than ball coordinates or scores.

The physics include sphere inertia, sliding-to-rolling cloth friction, rolling resistance, ball restitution, tangential collision friction, angular side-spin transfer, cushion friction, rounded pocket jaws, and six pocket mouths. Follow and draw result from the cue ball’s angular velocity after contact. This is a tunable planar simulation: it does not model jumps, masse, elevated cues, or cloth imperfections.

Refreshing or briefly losing the connection preserves a seat for **90 seconds**. New shots pause while an opponent is disconnected. An already-struck shot settles normally. Leaving deliberately or failing to reconnect forfeits an active frame. The UI reconnects automatically; the same tab keeps its seat token in session storage.

## Test

```bash
npm test
```

The Node tests cover collisions, draw/follow, side-spin cushion response, pocket capture, a full-power break settling, placement, fouls, black-ball results, rematches, and real HTTP/WebSocket room and reconnect flows. They need permission to bind a local port.

The browser suite starts its own temporary server and opens independent player contexts:

```bash
# If Chromium is not already installed:
npx playwright install --with-deps chromium
npm run test:browser
```

The harness uses `/usr/bin/chromium` when available, otherwise Playwright’s Chromium. Set `BROWSER_PATH` to override this. It tests actual cue dragging, spin, power dragging, a complete break, refreshing a live seat, scratch and ball placement, legal and premature black-ball pots, rematching, and mobile touch controls. Selected endgame layouts are injected only into the test-owned server’s memory; no fixture or debug endpoint exists in the production server. Screenshots are written to the ignored `test-results/` directory.

## Deploy on Render

The included [`render.yaml`](render.yaml) defines a single Node web service.

1. Push this project to your GitHub repository.
2. In Render, choose **New → Blueprint**, select the repository, and use its `render.yaml`.
3. Deploy the service, then share its Render HTTPS URL with both players.

You can also create a **Web Service** manually with these settings:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm ci --omit=dev` |
| Start command | `npm start` |
| Health check path | `/health` |
| Node version | `22.16.0` |

Render provides `PORT` and terminates TLS. The client automatically uses `wss://` on HTTPS and the same host’s `/ws` endpoint. There is no separate frontend deployment, build step, database, or secret configuration.

**Use a single instance.** Rooms live in process memory. Restarts, deploys, and a sleeping free-tier service discard existing rooms; a new room works once the service wakes. A free-tier cold start can take a moment. Persistent rooms or multiple instances would require a shared match store and coordinating the authoritative simulation. The app is prepared for Render, but deployment is a separate action.

## Files

- `server.js` — HTTP files, WebSocket protocol, room allocation, reconnects, simulation scheduling.
- `server/match.js` — room lifecycle, server validation, turn and result management.
- `shared/physics.js` — ball and cushion physics, pockets, placement, aim intersections.
- `shared/rules.js` — pure shot adjudication.
- `public/` — menu, lobby, game interface, Canvas rendering, and generated sound.
- `test/` — physics, rules, server integration, and browser coverage.
