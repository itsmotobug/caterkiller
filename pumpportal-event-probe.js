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
const ws = new WebSocketCtor(url);

let seen = 0;

ws.onopen = () => {
  console.log('Connected to PumpPortal websocket');
  
  // 1. Instantly subscribe to the global new token firehose to PROVABLY test your connection status
  console.log('Streaming global new tokens for 10 seconds to verify API key connection...');
  ws.send(JSON.stringify({ method: 'subscribeNewToken' }));

  // 2. After 10 seconds, unsubscribe from global and try your target mint
  setTimeout(() => {
    console.log('\n--- Unsubscribing from global firehose and moving to specific mints ---');
    ws.send(JSON.stringify({ method: 'unsubscribeNewToken' }));
    
    console.log('Testing subscribeTokenTrade for mint:', mint);
    ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [mint] }));
  }, 10000);

  // 3. After 12 seconds, add your secondary hot mint
  setTimeout(() => {
    console.log('Testing subscribeTokenTrade for additional hot mints');
    ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: ["jr963C1eUWRYk7TYAxii7MRyJqr1zJhVyZuYgVYpump", "DFMt2FyLpB6ekPNAzVErLXgpSnJ9CRf1VnxBAkTLpump", "3dgGDYKaab1pAZhaEC6gZQS3PrbZdShXMcoWeVZJpump", "E416wJCtCgjVPeRirpHd1qDvKRUy5oW6dnNhWQuxpump", "jr963C1eUWRYk7TYAxii7MRyJqr1zJhVyZuYgVYpump"] }));
  }, 12000);

  // 4. Close safely
  setTimeout(() => {
    console.log('Closing connection after 60s');
    ws.close();
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
  process.exit(0);
};
