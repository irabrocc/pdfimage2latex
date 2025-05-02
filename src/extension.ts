import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

// 全局状态管理
const anchorWatchers = new Map<string, vscode.FileSystemWatcher>();
// 修改：重命名同步监视器集合
const logSyncWatchers = new Map<string, vscode.FileSystemWatcher>();
let extensionContext: vscode.ExtensionContext;

// 配置参数
const config = {
	pythonPath: 'python', // 可扩展为从配置读取
	dpi: 300,
	maxRetries: 3,
	cooldown: 1000,
	logCheckDelay: 500
};

// 新增：获取日志文件路径
function getLogFilePath(texPath: string): string {
	return texPath.replace(/\.tex$/i, '.log');
}

export function activate(context: vscode.ExtensionContext) {
	extensionContext = context;

	// 初始化锚点监控
	vscode.workspace.onDidChangeTextDocument(event => {
		const doc = event.document;
		if (doc.languageId === 'latex' && doc.getText().includes('%ANCHOR%')) {
			setupAnchorSystem(doc);
		}
	});

	// 修改：初始化PDF同步系统时监控日志文件
	vscode.workspace.onDidSaveTextDocument(doc => {
		if (doc.languageId === 'latex') {
			setupPdfSyncSystem(doc);
		}
	});

	// 修改：初始化已打开文档时设置日志监控
	vscode.workspace.textDocuments.forEach(doc => {
		if (doc.languageId === 'latex') {
			if (doc.getText().includes('%ANCHOR%')) setupAnchorSystem(doc);
			setupPdfSyncSystem(doc);
		}
	});

	context.subscriptions.push(
		vscode.commands.registerCommand('pdfDiff.activate', () => {
			vscode.window.showInformationMessage('PDF Diff系统已激活!');
		})
	);
}

// ================= 锚点监控系统 =================
function setupAnchorSystem(document: vscode.TextDocument) {
	const texPath = document.uri.fsPath;
	const drawPdf = getDrawPdfPath(texPath);

	// 初始化Python脚本路径
	const pythonScript = getPythonScriptPath();
	if (!pythonScript) return;

	// 设置PDF差异监控
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

// ================ 修改后的PDF同步系统 ================
function setupPdfSyncSystem(document: vscode.TextDocument) {
	const texPath = document.uri.fsPath;
	const logPath = getLogFilePath(texPath);
	const pdfPath = getMainPdfPath(texPath);

	// 修改：监控日志文件而非PDF文件
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


// 新增：处理日志文件变化的函数
async function handleLogChange(pdfPath: string, logPath: string) {
	// 等待确保日志写入完成
	await delay(config.logCheckDelay);

	// 增加稳定性检查
	const isStable = await checkFileStable(logPath, 3, 200);
	if (!isStable) {
		console.log(`[SYNC] 忽略不稳定日志文件: ${path.basename(logPath)}`);
		return;
	}

	// 执行PDF同步
	try {
		await syncPdfFiles(pdfPath);
		console.log(`[SYNC] 由日志触发的PDF同步: ${path.basename(pdfPath)}`);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage(`PDF同步失败: ${errorMessage}`);
	}
}


// ================= 核心功能 =================
async function handlePdfDifference(texPath: string, drawPdf: string) {
	const pythonScript = getPythonScriptPath();
	if (!pythonScript) return;

	const mainPdf = getMainPdfPath(texPath);
	const imagesDir = path.join(path.dirname(texPath), 'images');

	try {
		// 生成差异图像
		const images = await executePythonDiff(
			pythonScript,
			drawPdf,
			mainPdf,
			imagesDir
		);

		// 更新LaTeX文档
		await updateLatexDocument(texPath, images);

		vscode.window.showInformationMessage(
			`成功插入 ${images.length} 张差异图`
		);
	} catch (error) {
		vscode.window.showErrorMessage(`差异生成失败: ${error}`);
	}
}

// ================= 工具函数 =================
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

// 修改：保持原有同步逻辑但增加PDF存在性检查
async function syncPdfFiles(pdfPath: string) {
	const drawPdf = getDrawPdfPath(pdfPath);

	// 新增：检查主PDF是否存在
	if (!fs.existsSync(pdfPath)) {
		throw new Error(`主PDF文件不存在: ${path.basename(pdfPath)}`);
	}

	// 保持原有的稳定性检查和同步逻辑
	const isStable = await checkFileStable(pdfPath, 3, 500);
	if (!isStable) {
		throw new Error(`PDF文件未稳定: ${path.basename(pdfPath)}`);
	}

	// 原有重试逻辑保持不变
	for (let i = 0; i < config.maxRetries; i++) {
		try {
			await fs.promises.copyFile(pdfPath, drawPdf);
			console.log(`[SYNC] 同步成功: ${path.basename(drawPdf)}`);
			return;
		} catch (error) {
			if (i === config.maxRetries - 1) throw error;
			await delay(500 * (i + 1));
		}
	}
}

// 新增文件稳定检测函数
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
			// 直接覆盖目标文件，增加可靠性
			await fs.promises.copyFile(src, dest);
			return;
		} catch (error) {
			if (i === config.maxRetries - 1) throw error;
			await delay(500 * (i + 1));
		}
	}
}


// ================= Python相关 =================
function getPythonScriptPath(): string | null {
	const scriptPath = extensionContext.asAbsolutePath('compare_pdfs.py');

	if (!fs.existsSync(scriptPath)) {
		vscode.window.showErrorMessage(
			`Python脚本缺失: ${scriptPath}\n请确认插件安装完整`
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
				reject('未检测到有效差异');
		});
	});
}

// ============== LaTeX文档更新 ==============
async function updateLatexDocument(texPath: string, images: string[]) {
	const doc = await vscode.workspace.openTextDocument(texPath);
	const editor = await vscode.window.showTextDocument(doc);

	// 查找所有锚点位置
	const anchorPositions: vscode.Position[] = [];
	const anchorRegex = /%ANCHOR%/g;

	let match;
	const text = doc.getText();
	while ((match = anchorRegex.exec(text)) !== null) {
		const pos = doc.positionAt(match.index);
		anchorPositions.push(pos);
	}

	// 生成替换内容
	const dir = path.dirname(texPath);
	const figures = images.map(img => {
		const relPath = path.relative(dir, img).replace(/\\/g, '/');
		return `\\begin{figure}[H]\n  \\includegraphics[width=\\textwidth]{${relPath}}\n\\end{figure}`;
	}).join('\n\n');

	// 执行批量替换
	await editor.edit(editBuilder => {
		anchorPositions.forEach(pos => {
			const range = new vscode.Range(
				pos,
				pos.translate(0, '%ANCHOR%'.length)
			);
			editBuilder.replace(range, figures);
		});
	});

	// 删除已使用的锚点
	const newText = doc.getText().replace(/%ANCHOR%/g, '');
	const fullRange = new vscode.Range(
		doc.positionAt(0),
		doc.positionAt(newText.length)
	);

	const edit = new vscode.WorkspaceEdit();
	edit.replace(doc.uri, fullRange, newText);
	await vscode.workspace.applyEdit(edit);
}

// ============== 辅助工具 ==============
function getMainPdfPath(texPath: string): string {
	return texPath.replace(/\.tex$/i, '.pdf');
}

function getDrawPdfPath(path: string): string {
	return path.replace(/\.(tex|pdf)$/i, '_draw.pdf');
}

function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// 修改：停用时清理正确的监视器
export function deactivate() {
	anchorWatchers.forEach(w => w.dispose());
	logSyncWatchers.forEach(w => w.dispose());  // 修改为清理logSyncWatchers
}