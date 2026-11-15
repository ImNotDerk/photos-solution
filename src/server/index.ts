import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import QRCode from 'qrcode';
import { routes, defaultSessionManager, SessionManager } from './routes.js';

export interface ServerOptions {
  stagingDir?: string;
  hardDriveRoot?: string;
  sessionManager?: SessionManager;
  clientDistDir?: string;
  port?: number;
  onBeforeVerification?: (destPaths: string[]) => Promise<void>;
}

/**
 * Detects the local LAN IPv4 address (e.g. 192.168.x.x, 10.x.x.x).
 * Prioritizes physical network interfaces (en0, eth0, wlan0).
 * Falls back to 127.0.0.1 if no external network interface is found.
 */
export function getLanIpAddress(): string {
  const interfaces = os.networkInterfaces();
  const candidates: { name: string; address: string }[] = [];

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      const isIpv4 = net.family === 'IPv4' || (net.family as any) === 4;
      if (isIpv4 && !net.internal) {
        candidates.push({ name, address: net.address });
      }
    }
  }

  const preferred = candidates.find((c) => /^(en|eth|wlan)/i.test(c.name));
  if (preferred) {
    return preferred.address;
  }

  return candidates[0]?.address || '127.0.0.1';
}

/**
 * Generates a terminal-renderable compact ASCII QR code for scanning from phone cameras.
 */
export async function generateQrCode(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'terminal', small: true });
}

/**
 * Expands leading tilde (~) in file paths to the user's home directory.
 */
export function expandHome(filePath: string): string {
  if (!filePath) return filePath;
  if (filePath === '~') {
    return os.homedir();
  }
  if (filePath.startsWith(`~${path.sep}`) || filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * Detects staging directory.
 * Order of precedence:
 * 1. customPath argument
 * 2. process.env.STAGING_DIR
 * 3. Most recently modified ~/Downloads/AirDrop* directory
 * 4. ./staging directory (if exists)
 * 5. Default fallback to ./staging
 */
export function detectStagingDirectory(customPath?: string): string {
  if (customPath && customPath.trim().length > 0) {
    return path.resolve(expandHome(customPath.trim()));
  }

  if (process.env.STAGING_DIR && process.env.STAGING_DIR.trim().length > 0) {
    return path.resolve(expandHome(process.env.STAGING_DIR.trim()));
  }

  try {
    const downloadsDir = path.join(os.homedir(), 'Downloads');
    if (fs.existsSync(downloadsDir)) {
      const entries = fs.readdirSync(downloadsDir, { withFileTypes: true });
      const airDropDirs = entries
        .filter((e) => e.isDirectory() && /^airdrop/i.test(e.name))
        .map((e) => {
          const fullPath = path.join(downloadsDir, e.name);
          const stat = fs.statSync(fullPath);
          return { path: fullPath, mtimeMs: stat.mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      if (airDropDirs.length > 0) {
        return airDropDirs[0].path;
      }
    }
  } catch {
    // Ignore read errors and continue fallback
  }

  const localStaging = path.resolve('staging');
  if (fs.existsSync(localStaging)) {
    return localStaging;
  }

  return path.resolve('./staging');
}

/**
 * Detects hard drive mount root.
 * Order of precedence:
 * 1. customDrive argument
 * 2. process.env.HARD_DRIVE_ROOT
 * 3. Default fallback to /Volumes
 */
export function detectHardDriveRoot(customDrive?: string): string {
  if (customDrive && customDrive.trim().length > 0) {
    return path.resolve(expandHome(customDrive.trim()));
  }

  if (process.env.HARD_DRIVE_ROOT && process.env.HARD_DRIVE_ROOT.trim().length > 0) {
    return path.resolve(expandHome(process.env.HARD_DRIVE_ROOT.trim()));
  }

  return '/Volumes';
}

/**
 * Parses CLI arguments (--staging, --drive, --port).
 */
export function parseCliArgs(args: string[] = process.argv.slice(2)): {
  staging?: string;
  drive?: string;
  port?: number;
} {
  const result: { staging?: string; drive?: string; port?: number } = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--staging' || arg === '-s') {
      result.staging = args[++i];
    } else if (arg.startsWith('--staging=')) {
      result.staging = arg.slice('--staging='.length);
    } else if (arg === '--drive' || arg === '-d') {
      result.drive = args[++i];
    } else if (arg.startsWith('--drive=')) {
      result.drive = arg.slice('--drive='.length);
    } else if (arg === '--port' || arg === '-p') {
      const p = parseInt(args[++i], 10);
      if (!isNaN(p)) result.port = p;
    } else if (arg.startsWith('--port=')) {
      const p = parseInt(arg.slice('--port='.length), 10);
      if (!isNaN(p)) result.port = p;
    }
  }
  return result;
}

/**
 * Factory creating the Fastify server instance with CORS, static file serving,
 * image preview routing, and REST API endpoints.
 */
export async function createServer(options?: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Register CORS
  await app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Register Multipart for streaming uploads with 200MB file limit
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 200 * 1024 * 1024,
    },
  });

  const sessionManager = options?.sessionManager || defaultSessionManager;
  const initialStaging = detectStagingDirectory(options?.stagingDir);
  const initialDrive = detectHardDriveRoot(options?.hardDriveRoot);

  sessionManager.setState({
    stagingDir: options?.stagingDir || sessionManager.getState().stagingDir || initialStaging,
    hardDriveRoot: options?.hardDriveRoot || sessionManager.getState().hardDriveRoot || initialDrive,
  });

  // 1. Static file serving for media files from staging
  const stagingToServe = sessionManager.getState().stagingDir || initialStaging;
  const stagingRoot = fs.existsSync(stagingToServe) ? path.resolve(stagingToServe) : process.cwd();

  await app.register(fastifyStatic, {
    root: stagingRoot,
    prefix: '/media/',
  });

  // 2. Static file serving for built React SPA frontend (dist/client or dist)
  const distCandidates = [
    options?.clientDistDir,
    path.resolve('dist/client'),
    path.resolve('dist'),
  ].filter((p): p is string => Boolean(p && fs.existsSync(p)));

  const clientDistDir = distCandidates[0];
  if (clientDistDir) {
    await app.register(fastifyStatic, {
      root: clientDistDir,
      prefix: '/',
      decorateReply: false,
      wildcard: false,
    });
  }

  // 3. Register domain REST API routes
  await app.register(routes, {
    sessionManager,
    onBeforeVerification: options?.onBeforeVerification,
  });

  // 4. Custom fallback handler to serve previewPath directly and support SPA routing
  app.setNotFoundHandler(async (request, reply) => {
    const rawUrl = request.raw.url || request.url;
    const urlPath = decodeURIComponent(rawUrl.split('?')[0]);
    const currentStaging = sessionManager.getState().stagingDir || initialStaging;
    const resolvedStaging = path.resolve(currentStaging);
    const stagingPrefix = resolvedStaging.endsWith(path.sep) ? resolvedStaging : resolvedStaging + path.sep;

    // Helper to safely serve a file ONLY if it is strictly confined within staging directory
    const serveIfInStaging = (candidatePath: string) => {
      const resolvedCandidate = path.resolve(candidatePath);
      if (!resolvedCandidate.startsWith(stagingPrefix)) {
        return null;
      }
      try {
        if (fs.existsSync(resolvedCandidate) && fs.statSync(resolvedCandidate).isFile()) {
          return reply.sendFile(path.basename(resolvedCandidate), path.dirname(resolvedCandidate));
        }
      } catch {
        return null;
      }
      return null;
    };

    // A. Direct match with bundle previewPath or asset files in session (strictly confined to staging)
    const bundles = sessionManager.getState().bundles;
    for (const b of bundles) {
      if (b.previewPath && (b.previewPath === urlPath || b.previewPath.endsWith(urlPath))) {
        const sent = serveIfInStaging(b.previewPath);
        if (sent) {
          return sent;
        }
      }
      const matchFile = b.files.find((f) => f.path === urlPath || f.path.endsWith(urlPath));
      if (matchFile) {
        const sent = serveIfInStaging(matchFile.path);
        if (sent) {
          return sent;
        }
      }
    }

    // B. Relative path inside staging directory (strictly verified within stagingPrefix)
    const cleanRel = urlPath.replace(/^\/+/, '');
    const candidateInStaging = path.resolve(resolvedStaging, cleanRel);
    const sentRel = serveIfInStaging(candidateInStaging);
    if (sentRel) {
      return sentRel;
    }

    // Case C removed: Never serve arbitrary disk paths outside staging directory

    // D. SPA HTML fallback if accepting HTML and client dist exists
    if (clientDistDir) {
      const indexHtml = path.join(clientDistDir, 'index.html');
      if (request.headers.accept?.includes('text/html') && fs.existsSync(indexHtml)) {
        return reply.sendFile('index.html', clientDistDir);
      }
    }

    return reply.status(404).send({ error: 'Not Found' });
  });

  return app;
}

/**
 * Starts the Fastify server and outputs LAN IP, URLs, and camera-scannable QR code.
 */
export async function startServer(cliOptions?: ServerOptions): Promise<FastifyInstance> {
  const cliArgs = parseCliArgs();
  const stagingDir = cliOptions?.stagingDir || cliArgs.staging;
  const hardDriveRoot = cliOptions?.hardDriveRoot || cliArgs.drive;
  const port = cliOptions?.port || cliArgs.port || (process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);

  const app = await createServer({
    stagingDir,
    hardDriveRoot,
    port,
    ...cliOptions,
  });

  await app.listen({ port, host: '0.0.0.0' });

  const lanIp = getLanIpAddress();
  const networkUrl = `http://${lanIp}:${port}`;
  const localUrl = `http://localhost:${port}`;
  const resolvedStaging = stagingDir || detectStagingDirectory();
  const resolvedDrive = hardDriveRoot || detectHardDriveRoot();

  console.log('='.repeat(58));
  console.log('  iPhone Photo Triage & Verified External Backup Server');
  console.log('='.repeat(58));

  try {
    const qrTerminal = await generateQrCode(networkUrl);
    console.log(qrTerminal);
  } catch (err) {
    console.warn('Could not generate terminal QR code:', err);
  }

  console.log(`\n  Local URL:    ${localUrl}`);
  console.log(`  Network URL:  ${networkUrl}`);
  console.log(`  Staging:      ${resolvedStaging}`);
  console.log(`  Hard Drive:   ${resolvedDrive}\n`);
  console.log('Scan the QR code with your iPhone Camera to open the Triage web app.\n');

  return app;
}

// Auto-run if executed directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('src/server/index.ts') ||
    process.argv[1].endsWith('src/server/index.js'));

if (isDirectRun) {
  startServer().catch((err) => {
    console.error('Fatal error starting photo triage server:', err);
    process.exit(1);
  });
}
