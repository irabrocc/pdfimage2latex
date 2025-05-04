# PDF Diff Visualizer for LaTeX

This extension is developed with the help of LLMs. This readme.md file has the general idea of the extension while some data might be wrong. This is a VS Code extension that automatically detects visual differences between PDF versions of LaTeX documents and generates annotated comparison images directly in your project.
![EffectDisplay](https://github.com/irabrocc/pdfimage2latex/blob/master/EffectDisplay.gif)


## Features

### 1. Smart PDF Comparison
- Automatically detects changes between `yourfile.pdf` and `yourfile_draw.pdf`
- Generates high-resolution difference images (default 300 DPI)
- Preserves document structure by analyzing text boundaries

### 2. LaTeX Integration
- Auto-inserts comparison figures at `%ANCHOR%` markers in the tex file
- Maintains relative paths for cross-platform compatibility
- Supports multi-page document comparison

### 3. Intelligent Monitoring
- Real-time watching of both `.tex` and `.log` files
- File stability detection prevents premature processing
- Configurable cooldown period between checks


## Requirements

- **Python 3.8+** with these packages:
  ```bash
  pip install pymupdf opencv-python
  ```
- LaTeX distribution (TeX Live/MikTeX)
- VS Code 1.75+

## Extension Settings

Configure in `settings.json`:
```json
{
  "pdfDiff.pythonPath": "python",
  "pdfDiff.dpi": 300,
  "pdfDiff.maxRetries": 3,
  "pdfDiff.cooldownMs": 1000
}
```

## Usage

1. Add `%ANCHOR%` markers in the tex file where you want difference images inserted
2. Save your `.tex` file to trigger comparison
3. Draw on the `_draw.pdf` file and save it   
4. View generated images in `./images/` directory
5. Compile the tex file to visualize `.pdf` with images inserted and to synchronize `.pdf` with `_draw.pdf` 

## Known Issues

- Complex layouts with overlapping elements may need manual adjustment
- First-run Python package installation may require VS Code restart
- If you want to modified the images inserted in the tex file, then the area of modifying should cover the original image in pdf 

## Release Notes

### 1.1.0
- Added log file monitoring for more reliable compiling detection
- Implemented file stability checks
- Improved error handling

### 1.0.0
- Initial release with core comparison functionality

---

## Development Guide

### Building
```bash
npm install -g @vscode/vsce
vsce package
```

### Testing
1. Install the `.vsix` file via VS Code Extensions view
2. Open a LaTeX project with test PDFs

---

**Pro Tip**: Use `Ctrl+Shift+P` → `Reload Window` after configuration changes.

For documentation on the comparison algorithm, see [compare_pdfs.py](compare_pdfs.py).

This extension follows the [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines).