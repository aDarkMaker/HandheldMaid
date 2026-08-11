import path from 'node:path';
import fs from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The Live2D model assets live at the repo root, two levels above the renderer.
const assetsDir = path.resolve(__dirname, '../../../assets');

const MIME: Record<string, string> = {
	'.json': 'application/json',
	'.png': 'image/png',
	'.moc3': 'application/octet-stream',
	'.css': 'text/css',
	'.js': 'text/javascript',
};

/**
 * Serve the repo-root `assets/` directory under the `/assets/` URL path so the
 * renderer can load Live2D models in dev. In production the assets are copied
 * into the bundle by the Tauri config.
 */
function serveRootAssets(): Plugin {
	return {
		name: 'serve-root-assets',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const url = req.url ?? '';
				if (!url.startsWith('/assets/')) return next();
				const rel = decodeURIComponent(url.replace(/^\/assets\//, '').split('?')[0]);
				const filePath = path.join(assetsDir, rel);
				fs.readFile(filePath, (err, data) => {
					if (err) {
						res.statusCode = 404;
						res.end('not found');
						return;
					}
					res.setHeader('Content-Type', MIME[path.extname(filePath)] ?? 'application/octet-stream');
					res.end(data);
				});
			});
		},
	};
}

// Tauri serves the frontend from a custom protocol in production, so each
// entry is bundled into a single HTML file via vite-plugin-singlefile:
// the transparent pet window (index.html) and the settings window (settings.html).
export default defineConfig({
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
	},
	envPrefix: ['VITE_', 'TAURI_'],
	plugins: [serveRootAssets()],
	build: {
		target: 'es2022',
		minify: 'esbuild',
		sourcemap: !!process.env.TAURI_DEBUG,
		plugins: [viteSingleFile()],
		rollupOptions: {
			input: {
				main: path.resolve(__dirname, 'index.html'),
				settings: path.resolve(__dirname, 'settings.html'),
			},
		},
	},
});
