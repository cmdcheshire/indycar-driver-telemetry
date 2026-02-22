# IndyCar Telemetry Overlay

Real-time broadcast graphics overlay system for IndyCar racing. Connects to IndyCar's live telemetry stream and renders data-driven overlays (leaderboards, driver cards, in-car HUDs) as browser sources for OBS or any streaming software.

![In-car HUD overlay](docs/Screenshot%202026-02-08%20at%2011.28.54%20AM.png)

## Quick Start

```bash
npm install
npm start          # http://localhost:3000
```

Default login: `admin` / `admin`

### Environment Variables (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `JWT_SECRET` | built-in | Token signing secret |
| `S3_BUCKET` | _(empty)_ | S3 bucket for graphics library (falls back to local disk) |
| `S3_REGION` | `us-east-1` | AWS region |
| `S3_PREFIX` | `library/` | Key prefix inside the bucket |

## How It Works

The system has four main parts: a **telemetry pipeline** that ingests live data, a **visual builder** for designing graphics, a **graphics control** panel for operating them live, and **overlay viewers** that render the final output in OBS.

```
IndyCar TCP Stream
       │
       ▼
  ┌──────────┐     ┌──────────────┐     ┌──────────────┐
  │  Server   │────▶│  Dashboard   │     │   Builder    │
  │ (Node.js) │     │  /dashboard  │     │   /builder   │
  │           │     └──────────────┘     └──────┬───────┘
  │  TCP ─▶   │                                 │ save
  │  Parse ─▶ │     ┌──────────────┐     ┌──────▼───────┐
  │  State ─▶ │────▶│  Gfx Control │────▶│   Overlay    │
  │  WS out   │     │ /graphics-   │     │  /overlay/   │
  │           │     │  control     │     │  :token      │
  └──────────┘     └──────────────┘     └──────────────┘
                         │                      ▲
                         │   TAKE ON / OFF      │
                         └──────────────────────┘
```

### Telemetry Pipeline

1. **TCP Client** (`src/telemetry/tcp-client.js`) connects to IndyCar's XML telemetry stream
2. **Message Processor** (`src/telemetry/message-processor.js`) parses XML into structured data (positions, timing, pit status, flags)
3. **Race State** (`src/telemetry/race-state.js`) is an EventEmitter that holds current race state and emits updates
4. **WebSocket Service** (`src/services/websocket.service.js`) broadcasts state to connected dashboard and overlay clients at 10Hz

### Visual Builder (`/builder`)

A drag-and-drop canvas editor for designing overlay graphics. Everything is positioned in percentages (0–100%) so graphics are resolution-independent.

**Element types:** text, textbox (multi-line), shape, image, arc gauge, bar gauge, ring segment, 3D scene (Three.js)

**Key features:**
- **Data binding** — bind any element to a telemetry field (speed, RPM, position, gap, driver name, etc.) via car number + data source + field selectors
- **Conditional styles** — change color/text/visibility based on data values (e.g., turn position text green when gaining)
- **Animation presets** — 27 enter, 27 exit, 18 emphasis animations with motorsport-tuned easings
- **Keyframe animation designer** — full timeline editor for custom enter/exit choreography with per-property tracks, easing curves, and live preview
- **Clipping masks** — use any element as a clip mask for another, with support for animated masks
- **Groups** — nest elements into groups for organizing complex layouts
- **Gauges** — arc, bar, and ring-segment gauges with smooth GSAP-tweened value transitions
- **Timeline** — define hold duration and preview the full IN → HOLD → OUT lifecycle with scrubbing
- **Exposed settings** — mark specific properties as operator-editable so the control panel can override them at showtime
- **Template thumbnails** — auto-captured on save and displayed in the template browser

### Graphics Control (`/graphics-control`)

The operator's panel for running graphics live during a broadcast.

- **Rundown** — ordered list of graphics items, each linked to a template with optional config overrides
- **TAKE ON / TAKE OFF** — trigger enter/exit animations on the overlay
- **Exposed settings** — per-item controls (car number, colors, text overrides) that the designer marked as editable
- **Live push** — config changes push to the overlay in real-time while a graphic is on-air

### Overlay Viewer (`/overlay/:accessToken`)

The browser source URL you add to OBS. Each overlay instance has a unique access token — no login required.

- Transparent background, sized to your canvas (typically 1920x1080)
- Receives template data + telemetry via WebSocket
- Renders elements, binds to live data, plays animations on TAKE ON/OFF commands
- Supports a configurable server-side delay buffer (0–60 seconds) to sync with broadcast delay
- Loads custom fonts and library assets on init, caches for performance

### Other Pages

| Page | Path | Purpose |
|------|------|---------|
| Dashboard | `/dashboard` | Live telemetry monitor, TCP connection status, overlay client list |
| Templates | `/templates` | Browse, duplicate, delete, import/export template designs |
| Library | `/library` | Upload and organize images, fonts, 3D models (local or S3) |
| Drivers | `/drivers` | Manage driver/team reference data and headshot images |
| Simulator | `/simulator` | Replay recorded telemetry XML for testing without a live feed |

## Project Structure

```
server.js                         Express + HTTP + WebSocket + TCP entry point
src/
  config/
    constants.js                  App-wide configuration
    database.js                   SQLite schema + migrations
  middleware/
    auth.middleware.js             JWT verification
    logging.middleware.js          Morgan HTTP logger
  routes/                         REST API endpoints
    auth.routes.js                Login, refresh, logout
    overlays.routes.js            Overlay CRUD + template assignment
    control.routes.js             Rundown + TAKE ON/OFF triggers
    telemetry.routes.js           TCP connect/disconnect
    settings.routes.js            App settings
    reference.routes.js           Driver/team data
    library.routes.js             Graphics library (S3/local)
    assets.routes.js              Image uploads
    simulator.routes.js           Telemetry replay
  services/
    websocket.service.js          WS server, broadcast, per-client delay buffers
    overlay.service.js            Template + overlay instance DB operations
    auth.service.js               JWT + refresh token management
    delay-buffer.service.js       Per-client telemetry delay queue
    reference-data.service.js     Driver/team data cache
    s3.service.js                 AWS S3 upload/delete/presign
    metrics.service.js            Message rate + connection metrics
    simulator.service.js          XML telemetry file replay over TCP
  telemetry/
    tcp-client.js                 TCP socket with XML boundary detection
    message-processor.js          XML → structured data parser
    race-state.js                 In-memory race state + EventEmitter
  utils/
    init.util.js                  First-run admin user creation

public/
  js/
    shared/                       Code shared between builder + overlay
      animation-presets.js        Enter/exit/emphasis animation definitions
      motorsport-easings.js       Custom GSAP easing curves
      clip-path.js                Clip-path geometry computation
      exposed-settings.js         Setting definitions per element type
      font-loader.js              Custom @font-face registration
      svg-gauge-utils.js          Arc/bar/ring gauge SVG generation
      scene3d-utils.js            Three.js 3D scene controller
      image-extrude.js            PNG/SVG → 3D extrusion
      binding-resolver.js         Telemetry field resolution
      expression-engine.js        Conditional style expression evaluator
    builder/                      Visual editor modules
      main.js                     Entry point, save/load, thumbnail capture
      canvas-engine.js            Element rendering + transform handles
      template-manager.js         Save/load API calls
      selection-manager.js        Multi-select, copy/paste
      drag-engine.js              Drag + resize with snapping
      snap-engine.js              Smart alignment snap guides
      history-manager.js          Undo/redo stack
      group-manager.js            Group nesting logic
      element-factory.js          Element creation defaults
      data-binding.js             Data source/field picker UI
      panels/
        properties-panel.js       Element property inspector
        layer-panel.js            Layer tree with drag reordering
        tools-panel.js            Shape/gauge/3D tool picker
        timeline-panel.js         IN/HOLD/OUT transport + scrubbing
        animation-designer.js     Keyframe timeline editor
        data-panel.js             Live telemetry data inspector
        preview-panel.js          OBS preview pane
        data-presets.js           Saved data binding configurations
    overlay/                      Overlay viewer modules
      main.js                     WebSocket handler, message queue
      template-loader.js          JSON → DOM builder, clip-path application
      element-renderer.js         Per-type DOM element creation
      data-binder.js              Live data → DOM updates + gauge values
      gsap-animation-engine.js    GSAP animation playback engine
      animation-engine.js         Legacy animation engine (fallback)
      asset-cache.js              Image/font preload cache
    vendor/                       Third-party libraries (GSAP, Three.js, html2canvas)

templates/                        Sample template JSON files
tools/
  simulator.js                    Standalone TCP stream simulator
data/
  telemetry.db                    SQLite database (auto-created)
```

## Animation System

Animations use [GSAP](https://greensock.com/gsap/) with custom motorsport-tuned easings:

| Easing | Character | Used for |
|--------|-----------|----------|
| `towerSnap` | Sharp snap with slight overshoot | Position tower entries |
| `dataPunch` | Quick settle | Data value changes, gauge tweening |
| `wipeDrive` | Accelerating wipe | Reveal/wipe-in animations |
| `exitAccel` | Fast exit ramp | Take-off animations |
| `celebBounce` | Bouncy settle | Winner celebrations |
| `springFirm` | Tight spring | Snappy UI elements |
| `springLoose` | Loose spring | Playful motion |
| `towerSettle` | Decelerate + settle | Leaderboard sort |

Templates define animations at the element level:
- **Preset animations** — pick from the library of 27 enter + 27 exit presets
- **Keyframe animations** — custom per-property timelines (opacity, position, scale, rotation, clip-path, color)
- **Emphasis animations** — triggered by data changes (pulse, flash, shake, etc.)

The **timeline transport** (RESET → TAKE ON → HOLD → TAKE OFF) previews the full animation lifecycle in the builder. The overlay plays the same sequences when triggered from graphics control.

## Data Binding

Any element can be bound to live telemetry data:

1. **Car selector** — pick a car by number, or use position-based selection (P1, P2, etc.), or bind to a target car slot
2. **Data source** — choose from timing, scoring, pit data, weather, etc.
3. **Field** — pick the specific field (speed, RPM, lastLapTime, gap, driverName, etc.)

The data binder resolves bindings every update cycle and writes values into the DOM. Gauges get smooth GSAP-tweened transitions. Conditional styles evaluate expressions against the current data to swap colors, text, or visibility.

## Template Workflow

1. **Design** in the builder (`/builder`) — lay out elements, bind data, configure animations
2. **Save** — template is stored in the database with an auto-captured thumbnail
3. **Create overlay instance** on the dashboard — gets a unique access token URL
4. **Build a rundown** in graphics control — add items referencing templates, override exposed settings
5. **Add overlay URL to OBS** as a browser source (1920x1080, transparent)
6. **TAKE ON / TAKE OFF** from graphics control to trigger animations live

## Development

```bash
npm run dev        # starts with --watch for auto-restart on server changes
```

Frontend files are served statically — edit and refresh the browser. No build step required.

The **simulator** (`/simulator`) replays recorded XML telemetry so you can test overlays without a live IndyCar feed. Point it at a telemetry XML file and it streams the data over a local TCP socket.
