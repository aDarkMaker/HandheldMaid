import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Tauri serves the frontend from a custom protocol in production, so we
// bundle everything into a single HTML file via vite-plugin-singlefile.
export default defineConfig({
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
	},
	envPrefix: ['VITE_', 'TAURI_'],
	build: {
		target: 'es2022',
		minify: 'esbuild',
		sourcemap: !!process.env.TAURI_DEBUG,
		plugins: [viteSingleFile()],
		rollupOptions: {
			output: {
				// Single-file build: inline all assets.
				inlineDynamicImports: true,
			},
		},
	},
});
