import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

let anchorWatchers: { [key: string]: vscode.FileSystemWatcher } = {};
let pdfWatchers: { [key: string]: vscode.FileSystemWatcher } = {};
let extensionContext: vscode.ExtensionContext; // 全局存储插件上下文

export function activate(context: vscode.ExtensionContext) {
	extensionContext = context; // 正确存储上下文

	vscode.workspace.onDidChangeTextDocument(event => {
		const document = event.document;
		if (document.languageId === 'latex' && document.getText().includes('%ANCHOR%')) {
			setupAnchorMonitoring(document);
		}
	});

	context.subscriptions.push(
		vscode.commands.registerCommand('anchorWatcher.activate', () => {
			vscode.window.showInformationMessage('Anchor Watcher is active!');
		})
	);
}

function setupAnchorMonitoring(document: vscode.TextDocument) {
	const texPath = document.uri.fsPath;
	const dir = path.dirname(texPath);
	const baseName = path.basename(texPath, '.tex');
	const drawPdf = path.join(dir, `${baseName}_draw.pdf`);

	// 使用全局 extensionContext
	const pythonScript = extensionContext.asAbsolutePath('compare_pdfs.py');

	if (!fs.existsSync(pythonScript)) {
		vscode.window.showErrorMessage(`Python脚本未找到: ${pythonScript}`);
		return;
	}

	// 设置PDF文件监视器
	if (!pdfWatchers[drawPdf]) {
		const watcher = vscode.workspace.createFileSystemWatcher(drawPdf);
		watcher.onDidChange(() => handlePdfChange(texPath, drawPdf));
		pdfWatchers[drawPdf] = watcher;
	}
	console.log('成功定位Python脚本:', pythonScript);
}

// 修正 handlePdfChange 函数
async function handlePdfChange(texPath: string, drawPdf: string) {
	const dir = path.dirname(texPath);
	const baseName = path.basename(texPath, '.tex');
	const mainPdf = path.join(dir, `${baseName}.pdf`);
	const imagesDir = path.join(dir, 'images');

	// 使用全局 extensionContext
	const pythonScript = extensionContext.asAbsolutePath('compare_pdfs.py');
	console.log('[DEBUG] Python脚本路径:', pythonScript);

	// 验证文件是否存在
	if (!fs.existsSync(pythonScript)) {
		vscode.window.showErrorMessage(`Python脚本不存在于: ${pythonScript}`);
		return;
	}

	const command = `python "${pythonScript}" "${drawPdf}" "${mainPdf}" --output-dir "${imagesDir}" --dpi 300`;

	exec(command, async (error, stdout, stderr) => {
		if (error) {
			vscode.window.showErrorMessage(`Error generating diff: ${stderr}`);
			return;
		}

		// 获取生成的图片列表
		const newImages = stdout.trim().split('\n');

		// 更新LaTeX文件
		const doc = await vscode.workspace.openTextDocument(texPath);
		let content = doc.getText();

		// 生成替换内容
		let replacement = '';
		newImages.forEach(img => {
			const relPath = path.relative(dir, img).replace(/\\/g, '/');
			replacement += `\\begin{figure}[H]\n  \\includegraphics[width=\\textwidth]{${relPath}}\n\\end{figure}\n\n`;
		});

		// 替换第一个锚点
		const newContent = content.replace('%ANCHOR%', replacement);

		// 写入文件
		const edit = new vscode.WorkspaceEdit();
		edit.replace(
			doc.uri,
			new vscode.Range(0, 0, doc.lineCount, 0),
			newContent
		);

		await vscode.workspace.applyEdit(edit);
		await doc.save();
	});
}

// 处理PDF自动复制
function setupPdfSync(pdfPath: string) {
	const watcher = vscode.workspace.createFileSystemWatcher(pdfPath);
	let isCopying = false;

	watcher.onDidChange(async () => {
		if (isCopying) return;

		const drawPdf = pdfPath.replace(/\.pdf$/, '_draw.pdf');
		try {
			isCopying = true;
			await fs.promises.copyFile(pdfPath, drawPdf);
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to sync PDF: ${err}`);
		} finally {
			setTimeout(() => isCopying = false, 1000);
		}
	});
}

export function deactivate() { }