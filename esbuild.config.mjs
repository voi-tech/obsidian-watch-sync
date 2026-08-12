import esbuild from 'esbuild';
import builtins from 'builtin-modules';

const watch = process.argv.includes('--watch');

const context = await esbuild.context({
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: ['obsidian', 'electron', ...builtins],
	format: 'cjs',
	target: 'es2022',
	logLevel: 'info',
	sourcemap: watch ? 'inline' : false,
	treeShaking: true,
	minify: !watch,
	outfile: 'main.js',
	// Handlebars ships an AST-based compiler that pulls in `fs`/`require` shims we
	// never use; the runtime-only build keeps the bundle small and CSP-friendly.
	define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
});

if (watch) {
	await context.watch();
} else {
	await context.rebuild();
	await context.dispose();
}
