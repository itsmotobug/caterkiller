#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function loadEnv(filePath) {
  const env = {};
  const data = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  for (const line of data.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    env[key] = value;
  }
  return env;
}

const env = { ...process.env, ...loadEnv(path.join(__dirname, '.env')) };
const apiKey = env.PUMP_API_KEY;
const mint = env.MINT;

if (!apiKey) {
  console.error('Missing PUMP_API_KEY in .env');
  process.exit(1);
}

if (!mint) {
  console.error('Missing MINT in .env');
  process.exit(1);
}

const url = 'wss://pumpportal.fun/api/data?api-key=' + encodeURIComponent(apiKey);
const WebSocketCtor = globalThis.WebSocket || require('ws');

let ws = null;
let seen = 0;
let shuttingDown = false;
const timers = new Set();

function registerTimer(fn, delayMs) {
  const handle = setTimeout(fn, delayMs);
  timers.add(handle);
  return handle;
}

function clearTimers() {
  for (const handle of timers) {
    clearTimeout(handle);
  }
  timers.clear();
}

function sendIfOpen(payload) {
  if (!ws || ws.readyState !== 1) {
    return false;
  }

  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch (error) {
    return false;
  }
}

function unsubscribeAllSources() {
  if (!ws || ws.readyState !== 1) {
    return;
  }

  sendIfOpen({ method: 'unsubscribeNewToken' });
  sendIfOpen({ method: 'unsubscribeTokenTrade', keys: [mint] });
  sendIfOpen({ method: 'unsubscribeTokenTrade', keys: ["81a4zMdXnAPCkH3NkE5nYXms56E2qWcrRmxuB9TTpump", "6tsykNmR3WDqouj9uVUFZRgR2Kpai4F1Qm1gAcirpump", "6x4Z2dr5DgHUBCKvta8T8GNsFTxJhsBZxNrycWQ8pump", "55A3VxMBfzw6uSe64zms5iMPw9k6kx9WzzusbCU6pump"] });
}

function shutdownProbe(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearTimers();
  unsubscribeAllSources();

  if (ws && ws.readyState === 1) {
    try {
      ws.close();
    } catch (error) {
      // Ignore close race conditions during forced shutdown.
    }
  }

  setTimeout(() => process.exit(code), 150);
}

ws = new WebSocketCtor(url);

ws.onopen = () => {
  console.log('Connected to PumpPortal websocket');
  
  // 1. Instantly subscribe to the global new token firehose to PROVABLY test your connection status
  console.log('Streaming global new tokens for 10 seconds to verify API key connection...');
  sendIfOpen({ method: 'subscribeNewToken' });

  // 2. After 10 seconds, unsubscribe from global and try your target mint
  registerTimer(() => {
    console.log('\n--- Unsubscribing from global firehose and moving to specific mints ---');
    sendIfOpen({ method: 'unsubscribeNewToken' });
    
    console.log('Testing subscribeTokenTrade for mint:', mint);
    sendIfOpen({ method: 'subscribeTokenTrade', keys: [mint] });
  }, 10000);

  // 3. After 12 seconds, add your secondary hot mint
  registerTimer(() => {
    console.log('Testing subscribeTokenTrade for additional hot mints');
    sendIfOpen({ method: 'subscribeTokenTrade', keys: ["81a4zMdXnAPCkH3NkE5nYXms56E2qWcrRmxuB9TTpump", "6tsykNmR3WDqouj9uVUFZRgR2Kpai4F1Qm1gAcirpump", "6x4Z2dr5DgHUBCKvta8T8GNsFTxJhsBZxNrycWQ8pump", "55A3VxMBfzw6uSe64zms5iMPw9k6kx9WzzusbCU6pump"] });
  }, 12000);

  // 4. Close safely
  registerTimer(() => {
    console.log('Closing connection after 60s');
    shutdownProbe(0);
  }, 60 * 1000);
};

// COMBINED ONMESSAGE ROUTINE (No longer overwriting itself)
ws.onmessage = (event) => {
  seen += 1;
  const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
  
  console.log('\n--- message #' + seen + ' ---');
  console.log(raw.slice(0, 2000));

  try {
    const obj = JSON.parse(raw);
    console.log('top-level keys:', Object.keys(obj));
    
    // PumpPortal payloads usually return data directly at the top level or inside a message block
    if (obj && typeof obj === 'object') {
      if (obj.data && typeof obj.data === 'object') {
        console.log('data keys:', Object.keys(obj.data));
      }
      if (obj.txType) {
        console.log(`[Trade Event] Type: ${obj.txType} | Mint: ${obj.mint} | SOL: ${obj.vSolInAvg || obj.solAmount}`);
      }
    }
  } catch (error) {
    console.log('parse error:', error.message);
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error && error.message ? error.message : error);
};

ws.onclose = () => {
  console.log('WebSocket closed');
  if (!shuttingDown) {
    process.exit(0);
  }
};

process.once('SIGINT', () => shutdownProbe(130));
process.once('SIGTERM', () => shutdownProbe(143));

process.once('exit', () => {
  if (ws && ws.readyState === 1) {
    try {
      unsubscribeAllSources();
      ws.close();
    } catch (error) {
      // Ignore exit-time cleanup races.
    }
  }
});
