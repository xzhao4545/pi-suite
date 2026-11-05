// Controlled stdio peer: tests exercise Pi's actual MCP transport and discovery,
// rather than registering ordinary extension tools with MCP-looking names.
import {appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';

const [server, trace] = process.argv.slice(2);
appendFileSync(trace, JSON.stringify({server, pid: process.pid}) + '\n');
const send = (value: object) => process.stdout.write(JSON.stringify(value) + '\n');
for await (const line of createInterface({input: process.stdin})) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  appendFileSync(trace, JSON.stringify({server, method: request.method, params: request.params}) + '\n');
  let result: object;
  switch (request.method) {
    case 'initialize': result = {protocolVersion: request.params.protocolVersion, serverInfo: {name: server, version: '1'}, capabilities: {tools: {}, resources: {}}}; break;
    case 'tools/list': result = {tools: ['allowed', 'denied'].map(name => ({name, description: name, inputSchema: {type: 'object', properties: {}}}))}; break;
    case 'tools/call': result = {content: [{type: 'text', text: `${server}:${request.params.name}`}]}; break;
    case 'resources/list': result = {resources: [{uri: `fixture://${server}/one`, name: 'Guide', mimeType: 'text/plain'}]}; break;
    case 'resources/templates/list': result = {resourceTemplates: []}; break;
    case 'resources/read': result = {contents: [{uri: request.params.uri, mimeType: 'text/plain', text: `${server}:resource`}]}; break;
    case 'ping': result = {}; break;
    default: send({jsonrpc: '2.0', id: request.id, error: {code: -32601, message: `Unknown method ${request.method}`}}); continue;
  }
  send({jsonrpc: '2.0', id: request.id, result});
}
