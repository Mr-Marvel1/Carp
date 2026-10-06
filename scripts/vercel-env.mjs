import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const requiredNames = ['SUPABASE_DB_URL', 'PG_CA_CERT', 'SESSION_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'];

function runVercel(args, input = '') {
  return new Promise((resolveProcess, reject) => {
    const child = spawn('npx', ['--yes', 'vercel', ...args], {
      env: process.env,
      shell: process.platform === 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolveProcess({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function loadCaCertificate() {
  if (process.env.PG_CA_CERT) return process.env.PG_CA_CERT.replace(/\\n/g, '\n');
  if (!process.env.PG_CA_CERT_PATH) throw new Error('PG_CA_CERT is missing and PG_CA_CERT_PATH is not configured.');
  return readFileSync(resolve(process.env.PG_CA_CERT_PATH), 'utf8');
}

function requiredValues() {
  const values = {
    SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
    PG_CA_CERT: loadCaCertificate(),
    SESSION_SECRET: process.env.SESSION_SECRET,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD
  };
  for (const name of requiredNames) {
    if (!values[name]) throw new Error(`Required local configuration is missing: ${name}.`);
  }
  if (values.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.');
  if (values.ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
  if (!values.PG_CA_CERT.includes('BEGIN CERTIFICATE')) throw new Error('The configured PG_CA_CERT is not PEM certificate data.');
  return values;
}

function parseExistingNames(output) {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Vercel did not return a parseable Production variable list.');
  const listing = JSON.parse(output.slice(start, end + 1));
  return new Set((listing.envs || []).map((entry) => entry.key).filter(Boolean));
}

const values = requiredValues();
const listing = await runVercel(['env', 'ls', 'production', '--format', 'json']);
if (listing.code !== 0) throw new Error(`Could not verify existing Vercel Production variables (exit ${listing.code}); output suppressed.`);
const existing = parseExistingNames(`${listing.stdout}\n${listing.stderr}`);

for (const name of requiredNames) {
  if (existing.has(name)) {
    console.log(`Already configured: ${name}`);
    continue;
  }
  const result = await runVercel(['env', 'add', name, 'production', '--sensitive', '--yes'], values[name]);
  if (result.code !== 0) throw new Error(`Could not configure Production variable ${name} (exit ${result.code}); CLI output suppressed.`);
  console.log(`Configured Production variable: ${name}`);
}
