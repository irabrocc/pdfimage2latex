import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

// Global state management
const anchorWatchers = new Map<string, vscode.FileSystemWatcher>();
// Modified: Renamed PDF sync watcher collection
const logSyncWatchers = new Map<string, vscode.FileSystemWatcher>();
let extensionContext: vscode.ExtensionContext;

// Configuration parameters
const config = {
	pythonPath: 'python', // Can be extended to read from config
	dpi: 300,
	maxRetries: 3,
	cooldown: 1000,
	logCheckDelay: 500
};

// New: Get log file path
function getLogFilePath(texPath: string): string {
	return texPath.replace(/\.tex$/i, '.log');
}

export function activate(context: vscode.ExtensionContext) {
	extensionContext = context;

	// Initialize anchor monitoring
	vscode.workspace.onDidChangeTextDocument(event => {
		const doc = event.document;
		if (doc.languageId === 'latex') {
			setupAnchorSystem(doc);
		}
	});

	// Modified: Initialize PDF sync system to monitor log files
	vscode.workspace.onDidSaveTextDocument(doc => {
		if (doc.languageId === 'latex') {
			setupPdfSyncSystem(doc);
		}
	});

	// Modified: Set up log monitoring when initializing open documents
	vscode.workspace.textDocuments.forEach(doc => {
		if (doc.languageId === 'latex') {
			if (doc.getText().includes('%ANCHOR%')) setupAnchorSystem(doc);
			setupPdfSyncSystem(doc);
		}
	});

	context.subscriptions.push(
		vscode.commands.registerCommand('pdfDiff.activate', () => {
			vscode.window.showInformationMessage('PDF Diff system activated!');
		})
	);
}

// ================= Anchor Monitoring System =================
function setupAnchorSystem(document: vscode.TextDocument) {
	const texPath = document.uri.fsPath;
	const drawPdf = getDrawPdfPath(texPath);
	const hasAnchor = document.getText().includes('%ANCHOR%');

	const existingWatcher = anchorWatchers.get(drawPdf);
	if(!hasAnchor && existingWatcher) {
		existingWatcher.dispose();
		anchorWatchers.delete(drawPdf);
		return;
	}

	if (!hasAnchor) return; 

	// Initialize Python script path
	const pythonScript = getPythonScriptPath();
	if (!pythonScript) return;

	// Set up PDF diff monitoring
	if (!anchorWatchers.has(drawPdf)) {
		const watcher = createSmartPdfWatcher(
			drawPdf,
			() => handlePdfDifference(texPath, drawPdf),
			config.cooldown
		);
		anchorWatchers.set(drawPdf, watcher);
		extensionContext.subscriptions.push(watcher);
	}
}

// ================= Modified PDF Sync System =================
function setupPdfSyncSystem(document: vscode.TextDocument) {
	const texPath = document.uri.fsPath;
	const logPath = getLogFilePath(texPath);
	const pdfPath = getMainPdfPath(texPath);

	// Modified: Monitor log files instead of PDF files
	if (!logSyncWatchers.has(logPath)) {
		const watcher = createSmartPdfWatcher(
			logPath,
			() => handleLogChange(pdfPath, logPath),
			config.cooldown
		);
		logSyncWatchers.set(logPath, watcher);
		extensionContext.subscriptions.push(watcher);
	}
}

// New: Handle log file changes
async function handleLogChange(pdfPath: string, logPath: string) {
	// Wait to ensure log writing completes
	await delay(config.logCheckDelay);

	// Add stability check
	const isStable = await checkFileStable(logPath, 3, 200);
	if (!isStable) {
		console.log(`[SYNC] Ignoring unstable log file: ${path.basename(logPath)}`);
		return;
	}

	// Execute PDF sync
	try {
		await syncPdfFiles(pdfPath);
		console.log(`[SYNC] PDF sync triggered by log: ${path.basename(pdfPath)}`);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage(`PDF sync failed: ${errorMessage}`);
	}
}

// ================= Core Functionality =================
async function handlePdfDifference(texPath: string, drawPdf: string) {
	const pythonScript = getPythonScriptPath();
	if (!pythonScript) return;

	const mainPdf = getMainPdfPath(texPath);
	const imagesDir = path.join(path.dirname(texPath), 'images');

	try {
		// Generate diff images
		const images = await executePythonDiff(
			pythonScript,
			drawPdf,
			mainPdf,
			imagesDir
		);

		// Update LaTeX document
		await updateLatexDocument(texPath, images);

		vscode.window.showInformationMessage(
			`Successfully inserted ${images.length} diff images`
		);
	} catch (error) {
		vscode.window.showErrorMessage(`Diff generation failed: ${error}`);
	}
}

// ================= Utility Functions =================
function createSmartPdfWatcher(
	pdfPath: string,
	callback: () => Promise<void>,
	cooldown: number
): vscode.FileSystemWatcher {
	let isProcessing = false;
	const watcher = vscode.workspace.createFileSystemWatcher(pdfPath);

	const handler = async () => {
		if (isProcessing) return;
		isProcessing = true;

		try {
			await callback();
		} finally {
			setTimeout(() => isProcessing = false, cooldown);
		}
	};

	watcher.onDidChange(handler);
	watcher.onDidCreate(handler);
	return watcher;
}

// Modified: Keep original sync logic but add PDF existence check
async function syncPdfFiles(pdfPath: string) {
	const drawPdf = getDrawPdfPath(pdfPath);

	// New: Check if main PDF exists
	if (!fs.existsSync(pdfPath)) {
		throw new Error(`Main PDF file not found: ${path.basename(pdfPath)}`);
	}

	// Keep original stability check and sync logic
	const isStable = await checkFileStable(pdfPath, 3, 500);
	if (!isStable) {
		throw new Error(`PDF file not stable: ${path.basename(pdfPath)}`);
	}

	// Keep original retry logic
	for (let i = 0; i < config.maxRetries; i++) {
		try {
			await fs.promises.copyFile(pdfPath, drawPdf);
			console.log(`[SYNC] Sync successful: ${path.basename(drawPdf)}`);
			return;
		} catch (error) {
			if (i === config.maxRetries - 1) throw error;
			await delay(500 * (i + 1));
		}
	}
}

// New: File stability check function
async function checkFileStable(filePath: string, checkCount = 3, interval = 200): Promise<boolean> {
	let lastSize = 0;
	let lastMtime = 0;

	for (let i = 0; i < checkCount; i++) {
		try {
			const stat = await fs.promises.stat(filePath);
			const currentSize = stat.size;
			const currentMtime = stat.mtimeMs;

			if (currentSize === lastSize && currentMtime === lastMtime) {
				return true;
			}

			lastSize = currentSize;
			lastMtime = currentMtime;
			await delay(interval);
		} catch {
			await delay(interval);
		}
	}
	return false;
}

async function atomicFileCopy(src: string, dest: string) {
	for (let i = 0; i < config.maxRetries; i++) {
		try {
			// Directly overwrite target file for reliability
			await fs.promises.copyFile(src, dest);
			return;
		} catch (error) {
			if (i === config.maxRetries - 1) throw error;
			await delay(500 * (i + 1));
		}
	}
}

// ================= Python Related =================
function getPythonScriptPath(): string | null {
	const scriptPath = extensionContext.asAbsolutePath('compare_pdfs.py');

	if (!fs.existsSync(scriptPath)) {
		vscode.window.showErrorMessage(
			`Python script missing: ${scriptPath}\nPlease confirm plugin installation`
		);
		return null;
	}
	return scriptPath;
}

async function executePythonDiff(
	pythonScript: string,
	oldPdf: string,
	newPdf: string,
	outputDir: string
): Promise<string[]> {
	const command = [
		config.pythonPath,
		`"${pythonScript}"`,
		`"${oldPdf}"`,
		`"${newPdf}"`,
		`--output-dir "${outputDir}"`,
		`--dpi ${config.dpi}`
	].join(' ');

	return new Promise((resolve, reject) => {
		exec(command, (error, stdout, stderr) => {
			if (error) return reject(stderr || error.message);

			const images = stdout.trim().split('\n')
				.filter(line => line.endsWith('.png'));

			images.length > 0 ? resolve(images) :
				reject('No valid differences detected');
		});
	});
}

// ================= LaTeX Document Update =================
async function updateLatexDocument(texPath: string, images: string[]) {
	const doc = await vscode.workspace.openTextDocument(texPath);
	const editor = await vscode.window.showTextDocument(doc);

	// Find all anchor positions
	const anchorPositions: vscode.Position[] = [];
	const anchorRegex = /%ANCHOR%/g;

	let match;
	const text = doc.getText();
	while ((match = anchorRegex.exec(text)) !== null) {
		const pos = doc.positionAt(match.index);
		anchorPositions.push(pos);
	}

	if (anchorPositions.length === 0) {
		vscode.window.showErrorMessage('No %ANCHOR% found in the document');
		throw new Error('No %ANCHOR% found');
	}

	// Generate replacement content
	const dir = path.dirname(texPath);
	const figures = images.map(img => {
		const relPath = path.relative(dir, img).replace(/\\/g, '/');
		return `\\begin{figure}[H]\n  \\includegraphics[width=\\textwidth]{${relPath}}\n\\end{figure}`;
	}).join('\n\n');

	// Perform batch replacement
	await editor.edit(editBuilder => {
		anchorPositions.forEach(pos => {
			const range = new vscode.Range(
				pos,
				pos.translate(0, '%ANCHOR%'.length)
			);
			editBuilder.replace(range, figures);
		});
	});

	// Remove used anchors
	const newText = doc.getText().replace(/%ANCHOR%/g, '');
	const fullRange = new vscode.Range(
		doc.positionAt(0),
		doc.positionAt(newText.length)
	);

	const edit = new vscode.WorkspaceEdit();
	edit.replace(doc.uri, fullRange, newText);
	await vscode.workspace.applyEdit(edit);
}

// ================= Helper Tools =================
function getMainPdfPath(texPath: string): string {
	return texPath.replace(/\.tex$/i, '.pdf');
}

function getDrawPdfPath(path: string): string {
	return path.replace(/\.(tex|pdf)$/i, '_draw.pdf');
}

function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// Modified: Clean up correct watchers when deactivating
export function deactivate() {
	anchorWatchers.forEach(w => w.dispose());
	logSyncWatchers.forEach(w => w.dispose());  // Modified to clean logSyncWatchers
}