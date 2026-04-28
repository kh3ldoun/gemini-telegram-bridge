import { spawn } from 'child_process';

const gemini = spawn('C:\\Users\\w_kha\\AppData\\Roaming\\npm\\gemini.cmd', ['--acp'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  shell: true
});

let rpcId = 1;
let sessionId = '';

function sendRpc(method: string, params: any = {}) {
  const id = rpcId++;
  const request = { jsonrpc: '2.0', id, method, params };
  console.log('Sending:', JSON.stringify(request));
  gemini.stdin.write(JSON.stringify(request) + '\n');
}

gemini.stdout.on('data', (data) => {
  const lines = data.toString().split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    console.log('Received:', line);
    try {
      const msg = JSON.parse(line);
      if (msg.id === 2 && msg.result) {
        sessionId = msg.result.sessionId;
        sendRpc('session/prompt', {
            sessionId: sessionId,
            prompt: [{ type: 'text', text: 'hi' }]
        });
      }
    } catch(e) {}
  }
});

setTimeout(() => sendRpc('initialize', { 
    protocolVersion: 1,
    capabilities: {},
    clientInfo: { name: "test", version: "1.0" }
}), 1000);

setTimeout(() => sendRpc('session/new', {
    cwd: process.cwd(),
    mcpServers: []
}), 3000);
