const { WebSocketServer } = require('ws');
const url = require('url');
const authService = require('./auth.service');
const overlayService = require('./overlay.service');
const DelayBuffer = require('./delay-buffer.service');
const metricsService = require('./metrics.service');
const state = require('../telemetry/race-state');

// Connected clients
const dashboardClients = new Map();   // ws -> { userId, username, connectedAt }
const overlayClients = new Map();     // ws -> { instanceId, name, accessToken, delayBuffer, connectedAt }

let wss = null;
let broadcastInterval = null;

function initialize(server) {
  wss = new WebSocketServer({ noServer: true });

  // Handle HTTP upgrade
  server.on('upgrade', (request, socket, head) => {
    const { pathname, query } = url.parse(request.url, true);

    if (pathname === '/ws/dashboard') {
      handleDashboardUpgrade(request, socket, head, query);
    } else if (pathname === '/ws/overlay') {
      handleOverlayUpgrade(request, socket, head, query);
    } else {
      socket.destroy();
    }
  });

  // Subscribe to race-state events for broadcasting
  state.on('telemetry', (data) => broadcastToAll('telemetry', data.full));
  state.on('leaderboard', (data) => broadcastToAll('leaderboard', data));
  state.on('lap', (data) => broadcastToAll('lap', data));
  state.on('pit', (data) => broadcastToAll('pit', data));
  state.on('carStatus', (data) => broadcastToAll('carStatus', data));
  state.on('flag', (data) => broadcastToAll('flag', data));

  // Periodic metrics broadcast
  broadcastInterval = setInterval(() => {
    const metrics = metricsService.getMetrics();
    metrics.connectedOverlayClients = overlayClients.size;
    metrics.connectedDashboardClients = dashboardClients.size;
    broadcastToDashboard('metrics', metrics);
  }, 5000);

  console.log('WebSocket service initialized.');
}

// ── Dashboard WebSocket ──

function handleDashboardUpgrade(request, socket, head, query) {
  const token = query.token;
  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  try {
    const decoded = authService.verifyToken(token);

    wss.handleUpgrade(request, socket, head, (ws) => {
      dashboardClients.set(ws, {
        userId: decoded.userId,
        username: decoded.username,
        connectedAt: new Date().toISOString(),
      });

      console.log(`Dashboard WS connected: ${decoded.username} (${dashboardClients.size} total)`);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          handleDashboardMessage(ws, msg);
        } catch (e) { /* ignore parse errors */ }
      });

      ws.on('close', () => {
        dashboardClients.delete(ws);
        console.log(`Dashboard WS disconnected (${dashboardClients.size} remaining)`);
      });

      ws.on('error', () => {
        dashboardClients.delete(ws);
      });

      // Send initial snapshot
      sendToDashboard(ws, 'raceState', {
        flagColor: state.flagColor,
        currentLap: state.currentLap,
        timeElapsed: state.timeElapsed,
        lapsCompleted: state.lapsCompleted,
        isOnline: state.isOnline,
      });

      sendToDashboard(ws, 'tcpStatus', getTcpStatus());

      // Send simulator status if available
      try {
        const simulatorService = require('./simulator.service');
        sendToDashboard(ws, 'simulatorStatus', simulatorService.getStatus());
      } catch (_) { /* simulator not loaded yet */ }
    });
  } catch (err) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
  }
}

function handleDashboardMessage(ws, msg) {
  switch (msg.type) {
    case 'requestSnapshot':
      sendToDashboard(ws, 'telemetry', state.telemetry);
      sendToDashboard(ws, 'leaderboard', state.leaderboard);
      sendToDashboard(ws, 'raceState', {
        flagColor: state.flagColor,
        currentLap: state.currentLap,
        timeElapsed: state.timeElapsed,
        lapsCompleted: state.lapsCompleted,
        isOnline: state.isOnline,
      });
      break;
  }
}

// ── Overlay WebSocket ──

function handleOverlayUpgrade(request, socket, head, query) {
  const token = query.token;
  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  let instance;
  try {
    instance = overlayService.getInstanceByToken(token);
  } catch (err) {
    console.error('Overlay WS upgrade failed (getInstanceByToken):', err.message);
    socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
    socket.destroy();
    return;
  }

  if (!instance) {
    console.warn(`Overlay WS rejected: no instance for token ${token.substring(0, 8)}...`);
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    try {
      const delayMs = (instance.delay_seconds || 0) * 1000;
      const delayBuffer = new DelayBuffer(delayMs);

      delayBuffer.onDrain = (message) => {
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(message);
        }
      };

      overlayClients.set(ws, {
        instanceId: instance.id,
        name: instance.name,
        accessToken: token,
        delayBuffer,
        connectedAt: new Date().toISOString(),
      });

      console.log(`Overlay WS connected: "${instance.name}" (${overlayClients.size} total)`);
      broadcastOverlayClientChange();

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'heartbeat') {
            const client = overlayClients.get(ws);
            if (client) client.lastHeartbeat = Date.now();
          } else if (msg.type === 'cacheStatus') {
            const client = overlayClients.get(ws);
            if (client) {
              client.cacheStatus = msg.data;
              broadcastOverlayClientChange();
            }
          }
        } catch (e) { /* ignore */ }
      });

      ws.on('close', () => {
        const client = overlayClients.get(ws);
        if (client) client.delayBuffer.clear();
        overlayClients.delete(ws);
        console.log(`Overlay WS disconnected (${overlayClients.size} remaining)`);
        broadcastOverlayClientChange();
      });

      ws.on('error', () => {
        const client = overlayClients.get(ws);
        if (client) client.delayBuffer.clear();
        overlayClients.delete(ws);
        broadcastOverlayClientChange();
      });

      // Check for on-air rundown item — send its template instead of the
      // instance's base template so overlay reconnects resume the active graphic
      const onAirItem = overlayService.getOnAirItemForInstance(instance.id);
      let initTemplate = instance.template_data;
      let initVisible = false;
      let initConfigOverrides = {};

      if (onAirItem && onAirItem.template_data) {
        initTemplate = onAirItem.template_data;
        initVisible = true;
        initConfigOverrides = onAirItem.config_overrides || {};
      }

      const initPayload = JSON.stringify({
        type: 'init',
        timestamp: Date.now(),
        data: {
          template: initTemplate,
          config: {
            delay: instance.delay_seconds,
            visible: initVisible,
            instanceId: instance.id,
            targetCars: state.targetCarNumbers,
            ...instance.instance_config,
            ...initConfigOverrides,
          },
          referenceData: state.referenceData,
          snapshot: {
            telemetry: state.telemetry,
            leaderboard: state.leaderboard,
            lapData: state.lapData,
            carStatus: state.carStatus,
            pitStatus: state.pitStatus,
            raceState: {
              flagColor: state.flagColor,
              currentLap: state.currentLap,
              timeElapsed: state.timeElapsed,
              lapsCompleted: state.lapsCompleted,
            },
          },
        },
      });

      ws.send(initPayload);
    } catch (err) {
      console.error('Overlay WS init error:', err.message);
      try { ws.close(); } catch (_) { /* ignore */ }
    }
  });
}

// ── Broadcasting ──

function sendToDashboard(ws, type, data) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type, timestamp: Date.now(), data }));
}

function broadcastToDashboard(type, data) {
  if (dashboardClients.size === 0) return;
  const message = JSON.stringify({ type, timestamp: Date.now(), data });
  for (const [ws] of dashboardClients) {
    if (ws.readyState === 1) ws.send(message);
  }
}

function broadcastToOverlays(type, data) {
  if (overlayClients.size === 0) return;
  const message = JSON.stringify({ type, timestamp: Date.now(), data });
  for (const [ws, client] of overlayClients) {
    if (ws.readyState !== 1) continue;
    if (client.delayBuffer.delayMs === 0) {
      ws.send(message);
    } else {
      client.delayBuffer.push(message);
    }
  }
}

function broadcastToAll(type, data) {
  broadcastToDashboard(type, data);
  broadcastToOverlays(type, data);
}

function broadcastControlUpdate() {
  broadcastToDashboard('controlUpdate', {
    isOnline: state.isOnline,
    targetCars: state.targetCarNumbers,
    tcpHost: state.tcpHost,
    tcpPort: state.tcpPort,
    manualDNF: state.manualDNFOverride.filter(d => d.DNF).map(d => d.carNumber),
  });

  // Also notify overlay clients of config changes
  for (const [ws, client] of overlayClients) {
    if (ws.readyState !== 1) continue;
    const msg = JSON.stringify({
      type: 'configUpdate',
      timestamp: Date.now(),
      data: { targetCars: state.targetCarNumbers },
    });
    if (client.delayBuffer.delayMs === 0) {
      ws.send(msg);
    } else {
      client.delayBuffer.push(msg);
    }
  }
}

function broadcastTcpStatus(status) {
  broadcastToDashboard('tcpStatus', status);
}

function broadcastOverlayClientChange() {
  const clients = [];
  for (const [, client] of overlayClients) {
    clients.push({
      instanceId: client.instanceId,
      name: client.name,
      connectedAt: client.connectedAt,
      delay: client.delayBuffer.delayMs / 1000,
      bufferStats: client.delayBuffer.getStats(),
      cacheStatus: client.cacheStatus || null,
    });
  }
  broadcastToDashboard('overlayClientChange', { clients });
}

function updateOverlayDelay(instanceId, delaySeconds) {
  for (const [, client] of overlayClients) {
    if (client.instanceId === instanceId) {
      client.delayBuffer.setDelay(delaySeconds * 1000);
    }
  }
}

function sendOverlayVisibility(instanceId, visible, animation, elementAnimations, timeline) {
  const data = {
    visible,
    animation: animation || (visible ? 'fadeIn' : 'fadeOut'),
    elementAnimations: elementAnimations || [],
  };
  if (timeline) data.timeline = timeline;

  const message = JSON.stringify({
    type: 'visibility',
    timestamp: Date.now(),
    data,
  });

  for (const [ws, client] of overlayClients) {
    if (client.instanceId === instanceId && ws.readyState === 1) {
      ws.send(message); // Visibility commands bypass delay
    }
  }
}

function sendOverlayTemplateUpdate(instanceId, templateData) {
  const message = JSON.stringify({
    type: 'templateUpdate',
    timestamp: Date.now(),
    data: {
      template: templateData.template_data || templateData,
      referenceData: state.referenceData,
    },
  });

  for (const [ws, client] of overlayClients) {
    if (client.instanceId === instanceId && ws.readyState === 1) {
      ws.send(message);
    }
  }
}

function sendOverlayResume(instanceId) {
  const message = JSON.stringify({ type: 'resume', timestamp: Date.now() });
  for (const [ws, client] of overlayClients) {
    if (client.instanceId === instanceId && ws.readyState === 1) {
      ws.send(message);
    }
  }
}

function sendOverlayCue(instanceId, templateData, config, elementAnimations, timeline) {
  const message = JSON.stringify({
    type: 'cue',
    timestamp: Date.now(),
    data: {
      template: templateData.template_data || templateData,
      config: config || {},
      referenceData: state.referenceData,
      elementAnimations: elementAnimations || [],
      timeline: timeline || null,
    },
  });

  for (const [ws, client] of overlayClients) {
    if (client.instanceId === instanceId && ws.readyState === 1) {
      ws.send(message);
    }
  }
}

function sendOverlayConfigUpdate(instanceId, config) {
  const message = JSON.stringify({
    type: 'configUpdate',
    timestamp: Date.now(),
    data: config,
  });

  for (const [ws, client] of overlayClients) {
    if (client.instanceId === instanceId && ws.readyState === 1) {
      ws.send(message);
    }
  }
}

let tcpStatusData = { connected: false, host: null, port: null, connectedAt: null };

function setTcpStatus(status) {
  tcpStatusData = status;
  broadcastTcpStatus(status);
}

function getTcpStatus() {
  return tcpStatusData;
}

function getConnectedOverlayClients() {
  const clients = [];
  for (const [, client] of overlayClients) {
    clients.push({
      instanceId: client.instanceId,
      name: client.name,
      connectedAt: client.connectedAt,
      delay: client.delayBuffer.delayMs / 1000,
    });
  }
  return clients;
}

function shutdown() {
  if (broadcastInterval) clearInterval(broadcastInterval);
  if (wss) wss.close();
}

module.exports = {
  initialize,
  broadcastToDashboard,
  broadcastToOverlays,
  broadcastToAll,
  broadcastControlUpdate,
  broadcastTcpStatus,
  broadcastOverlayClientChange,
  updateOverlayDelay,
  sendOverlayVisibility,
  sendOverlayResume,
  sendOverlayCue,
  sendOverlayTemplateUpdate,
  sendOverlayConfigUpdate,
  setTcpStatus,
  getTcpStatus,
  getConnectedOverlayClients,
  shutdown,
};
