const { state } = require('../state');
const { ENDPOINTS } = require('../config');
const { extractTradePrice } = require('../trading/price');
const { maybeAutoTrade } = require('../trading/autotrade');
const { startStatusRenderLoop, stopStatusRenderLoop } = require('../ui/status');
const { debugTradeSignal } = require('../log');

const RECONNECT_DELAY_MS = 5000;

// Socket calls can race with closing sockets; a failed send just leaves state unchanged.
const attempt = (fn) => {
  try {
    fn();
    return true;
  } catch (error) {
    return false;
  }
};

const syncMintSubscription = () => {
  const socket = state.websocket;
  if (!socket || socket.readyState !== 1) {
    return;
  }

  const currentMint = String(state.mint || '').trim();
  if (!currentMint) {
    return;
  }

  const send = (message) => attempt(() => socket.send(JSON.stringify(message)));

  if (state.lastSubscribedMint && state.lastSubscribedMint !== currentMint) {
    send({ method: 'unsubscribeTokenTrade', keys: [state.lastSubscribedMint] });
  }

  if (state.lastSubscribedMint !== currentMint && send({ method: 'subscribeTokenTrade', keys: [currentMint] })) {
    state.lastSubscribedMint = currentMint;
  }
};

const cleanupRealtimeSocket = () => {
  if (!state.websocket || state.shuttingDown) {
    return;
  }

  state.shuttingDown = true;
  console.log('Tearing down PumpPortal websocket connection cleanly...');

  attempt(() => {
    if (state.mint && state.websocket.readyState === 1) {
      state.websocket.send(JSON.stringify({ method: 'unsubscribeTokenTrade', keys: [state.mint] }));
      console.log('Unsubscribed from mint:', state.mint);
    }
  });

  attempt(() => {
    if (state.websocket.readyState === 1) {
      state.websocket.close();
      console.log('PumpPortal websocket closed.');
    }
  });
};

const scheduleReconnect = () => {
  setTimeout(() => {
    if (!state.shuttingDown) {
      connectRealtime();
    }
  }, RECONNECT_DELAY_MS);
};

const handleStreamMessage = async (event) => {
  state.sessionEventCount += 1;
  state.lastWsEventAt = Date.now();

  if (state.debug) {
    console.log('[ws] we got an event');
  }

  try {
    const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
    if (!raw) {
      return;
    }

    if (state.debug) {
      console.log('[ws] raw event:', raw.slice(0, 1500));
    }

    const payload = JSON.parse(raw);
    const price = extractTradePrice(payload, state.mint);
    if (!price || price <= 0) {
      if (state.debug) {
        debugTradeSignal('ws event ignored: no usable price in payload | keys=' + Object.keys(payload || {}).slice(0, 10).join(', '));
      }
      return;
    }

    state.lastPrice = Number(state.currentPrice) > 0 ? state.currentPrice : price;
    state.currentPrice = price;
    if (state.debug) {
      debugTradeSignal('ws price cached: ' + price + ' | keys=' + Object.keys(payload || {}).slice(0, 10).join(', '));
    }
    await maybeAutoTrade();
  } catch (error) {
    if (state.debug) {
      console.log('[ws] parse ignored:', String(error && error.message ? error.message : error));
    }
  }
};

const connectRealtime = async () => {
  if (!state.apiKey) {
    console.log('Live stream disabled: missing PUMP_API_KEY in .env');
    return null;
  }

  if (state.shuttingDown) {
    return null;
  }

  const WebSocketCtor = globalThis.WebSocket || require('ws');
  const ws = new WebSocketCtor(ENDPOINTS.stream + encodeURIComponent(state.apiKey));

  ws.onopen = () => {
    state.liveStreamReady = true;
    state.shuttingDown = false;
    startStatusRenderLoop();
    console.log('Connected to PumpPortal realtime stream.');
    if (state.mint) {
      console.log('Subscribing to token trade for mint:', state.mint);
      syncMintSubscription();
    }
  };

  ws.onmessage = handleStreamMessage;

  ws.onclose = () => {
    state.liveStreamReady = false;
    stopStatusRenderLoop();
    if (!state.shuttingDown) {
      console.log('PumpPortal stream closed.');
      scheduleReconnect();
    }
  };

  ws.onerror = (error) => {
    state.liveStreamReady = false;
    stopStatusRenderLoop();
    console.log('PumpPortal stream error: ' + String(error && error.message ? error.message : error));
    if (!state.shuttingDown) {
      scheduleReconnect();
    }
  };

  state.websocket = ws;
  return ws;
};

module.exports = { connectRealtime, cleanupRealtimeSocket, syncMintSubscription };
