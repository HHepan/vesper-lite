import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:11001/ws');

ws.on('open', () => {
  console.log('WS opened');
  ws.send(JSON.stringify({ cmd: 'session_list_active' }));
  ws.send(JSON.stringify({ cmd: 'list_profiles' }));
  ws.send(JSON.stringify({ cmd: 'session_restore', sessionId: 's1' }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('RECV:', msg.type, Object.keys(msg));
  if (msg.type === 'profile_list' || msg.type === 'profiles_list') {
    console.log('  PROFILES MSG:', JSON.stringify(msg));
  }
  if (msg.type === 'provider_state') {
    console.log('  PROVIDER STATE:', JSON.stringify(msg));
  }
  if (msg.type === 'session_state') {
    console.log('  SESSION STATE:', JSON.stringify(msg));
  }
});

setTimeout(() => {
  ws.close();
  process.exit(0);
}, 2000);
