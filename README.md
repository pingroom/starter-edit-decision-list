# Edit decision list with PingRoom

Have a named editor choose one video take per scene, then export a cut timeline with exact source-frame ranges. PingRoom collects the choices; application code joins the selected ranges in scene order.

Prepare two or three candidate takes per scene after the editor reviews the source media. The garden-walkthrough example produces a custom JSON edit list. Media review, rendering and import into an editing application remain separate steps.

## Try it offline

Choose **Use this template**, clone your copy and install Node.js 22 or newer:

```sh
npm ci
npm test
npm run demo
cp examples/edit.json edit.json
cp config.example.json config.json
npm run preview
```

The demos build two different cuts and show an Unknown choice blocking export. They use the real pinned SDK with a local mock transport, need no credentials and remove their temporary files. Live phone delivery is not tested.

## Define scenes and takes

Edit `edit.json` before starting. Use `preview` to review the metadata; review the media separately with the editor.

- `projectId`, `title`, `fps`: project identity, title and a common integer frame rate from 1 to 120.
- `sources`: 1–8 objects with `id`, `label` and `totalFrames`.
- `scenes`: 1–8 objects with `id`, `label` and `takes`, in the intended timeline order.
- Each scene has 2–3 takes with `id`, `label`, `sourceId`, `sourceIn` and `sourceOut`.

Frame indices are **zero-based and half-open**: `[120,240)` includes source frames 120 through 239 and lasts 120 frames. `sourceOut` may equal `totalFrames`. Every range must be nonempty and stay within its declared source. Source lengths and range endpoints are integers bounded to 100,000,000. The final timeline starts at zero and contains one contiguous video track with one source frame per timeline frame.

Scene, source and take IDs start with a lowercase letter, use lowercase letters, digits, `_` or `-`, and contain at most 12 characters. Reserved object names and `unknown` are excluded. IDs must be unique within their respective lists; a take ID may recur in another scene. Two takes in one scene cannot identify the same source range. Project IDs allow 40 characters. Titles, scene labels and source labels allow 40 UTF-16 units; take labels allow 26. Text must be trimmed, well formed and free of control characters.

Unknown fields, sparse lists, numeric strings, fractional frames/fps, invalid references and duplicate IDs fail validation. Sources sort by ID before the input hash is calculated. Scene order and take option order are preserved: changing either, any label, range, source length or fps requires a new session. Input files are bounded to 64 KiB and outputs to 1 MiB.

## Connect the editor

Install [PingRoom](https://pingroom.io/i), then run:

```sh
npm run connect
npm run inspect
```

Approve the displayed connection link and grant the intended standard private room. Verify the editor in the app, then set their exact member UUID and label in `config.json`. A display name alone does not establish identity.

For an existing robot, copy `.env.example` to `.env` and set both `PINGROOM_TOKEN` and `PINGROOM_ROOM`. Partial or blank pairs fail rather than mixing credential sources. The connection needs room-list access and permission to create and read Questions in that room.

```sh
npm start
```

Each invocation creates at most one direct Question or reads the pending Question. After the editor answers, run again to record it, then again for the next scene. Each Question lasts 15 minutes and offers the named takes plus **Unknown**.

Questions send the title, scene position/ID/label, frame rate, take IDs/labels, source IDs/ranges, intended editor UUID, and input/scene/policy hashes to PingRoom. Source labels and total lengths stay in the local input; media is never sent. Keep sensitive material out of metadata.

Unknown, missing evidence, expiry, cancellation or an invalid answer withholds the entire timeline. Later scenes can still be collected. Exact input, request, room, editor, asking registration and timestamps are checked. The application does not poll or resend automatically.

## Export and adapt

```sh
npm run status
npm run report
npm run export
```

These commands run locally. `report` writes `.edit/report.json`, including partial evidence. When every scene has a known take, `export` writes `.edit/timeline.json`. The file contains the full report: **read its `timeline` field** for the custom `pingroom-cut-list-v1` edit list, and `answers` for the attributed Question evidence.

Each cut includes `sceneId`, `takeId`, `sourceId`, `sourceIn`, `sourceOut`, `timelineIn`, `timelineOut` and `durationFrames`. All out positions are exclusive. For a frame inside a cut:

```js
sourceFrame = cut.sourceIn + (timelineFrame - cut.timelineIn);
```

`timeline.totalFrames` is the end boundary, not a playable frame. Seconds are frame counts divided by `timeline.fps`; no timecode strings or rounding are used. The `buildTimeline(input, selections)` and `mapTimelineFrame(input, selections, frame)` exports in `src/model.js` calculate metadata for local adapters. Use the CLI export to retain validated evidence of the editor’s decisions.

Adapt your media inventory to the input schema, then write an adapter that resolves source IDs to verified media and translates the exported ranges for your editor. Verify the actual source frame rates, lengths and media identity before rendering. This starter has no CMX3600/EDL, XML or editor-native format compatibility. Audio, transitions, gaps, overlapping tracks, drop-frame/fractional frame rates and speed changes need separate integrations. No deployment or media-processing action is implemented.

Run/recover exits `0` for a complete timeline, `1` on errors, `2` for incomplete/Unknown/failed answers, `3` for pending/ready/interrupted work and `4` for uncertain creation. Local inspection/reporting exits `0` when inspection succeeds, even for partial evidence. Export refuses incomplete evidence.

## Resume safely

After a lost creation response, preserve `.edit/state.json`. Run `npm run find-id`, inspect candidates, then `npm run recover -- QUESTION_UUID` for the original Question. An empty bounded search does not prove creation failed. Do not erase state to retry a send.

Pairing saves its pending credentials and session, or its intent when creation is uncertain. Resume a known pairing with `npm run connect`; inspect Connected Agents and resolve or revoke an uncertain or expired registration before starting another connection.

Keep input, configuration, room and credentials unchanged during a session. Resolve it before archiving `.edit/` for a revised edit. Remove stale locks only after confirming no process is active. Root input, credentials and runtime state are ignored by Git. Files use private atomic writes under a local lock; hashes detect mismatches but are not signed history.

The project pins `@pingroom/sdk` 0.8.0 with a lockfile. `.npmrc` requests exact saves and a 14-day release age where npm supports it. Commit-pinned Actions check Node 22 and 24. Tests include an independent per-frame oracle across 81 take combinations, range boundaries, recovery, pairing and actual CLI subprocesses. MIT licensed.
