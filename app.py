#!/usr/bin/env python3
"""
Simple Theme Editor with Live Preview
"""

import os
import json
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import aiofiles

app = FastAPI(title="Theme Editor", version="1.0.0")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
THEME_FILE_PATH = "/home/acleda/Documents/PlatformIO/Projects/esp_khmer_text/theme_clock_test_template.html"

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

manager = ConnectionManager()

# Serve favicon
@app.get("/favicon.ico")
async def favicon():
    """Return empty favicon"""
    return {"message": "No favicon"}

# Serve the main UI
@app.get("/", response_class=HTMLResponse)
async def get_ui():
    """Serve the main editor UI"""
    return """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Theme Editor</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #f0f2f5;
            height: 100vh;
            overflow: hidden;
        }

        .container {
            display: flex;
            height: 100vh;
            gap: 2px;
        }

        .panel {
            background: white;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            flex: 1;
            min-width: 200px;
        }

        .resizer {
            width: 4px;
            background: #bdc3c7;
            cursor: col-resize;
            position: relative;
            flex-shrink: 0;
        }

        .resizer:hover {
            background: #95a5a6;
        }

        .resizer.dragging {
            background: #3498db;
        }

        .header {
            background: #2c3e50;
            color: white;
            padding: 15px 20px;
            font-weight: bold;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .editor-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .toolbar {
            background: #ecf0f1;
            padding: 10px;
            border-bottom: 1px solid #bdc3c7;
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
        }

        .code-editor-wrapper {
            flex: 1;
            position: relative;
            background: #1e1e1e;
            overflow: hidden;
        }

        .code-editor {
            width: 100%;
            height: 100%;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            padding: 15px;
            background: transparent;
            color: #d4d4d4;
            overflow: auto;
            white-space: pre-wrap;
            tab-size: 2;
            line-height: 1.5;
            border: none;
            outline: none;
            resize: none;
            position: relative;
            z-index: 2;
        }

        .code-highlighted {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            padding: 15px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            white-space: pre-wrap;
            tab-size: 2;
            line-height: 1.5;
            overflow: hidden;
            pointer-events: none;
            z-index: 1;
            color: transparent;
        }

        .preview-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .preview-canvas {
            flex: 1;
            background: #1a1a1a;
            display: flex;
            justify-content: center;
            align-items: center;
            position: relative;
            overflow: auto;
            padding: 20px;
        }

        .led-grid-container {
            background: #0a0a0a;
            border: 3px solid #333;
            border-radius: 8px;
            padding: 15px;
            box-shadow: inset 0 0 20px rgba(0,0,0,0.8);
            position: relative;
        }

        #ledCanvas {
            image-rendering: pixelated;
            image-rendering: crisp-edges;
            width: 640px;
            height: 320px;
            border: 1px solid #222;
        }

        .controls {
            background: #ecf0f1;
            padding: 15px;
            border-top: 1px solid #bdc3c7;
        }

        .control-group {
            margin-bottom: 10px;
        }

        .control-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 600;
            color: #2c3e50;
        }

        .control-group input, .control-group select {
            width: 100%;
            padding: 8px;
            border: 1px solid #95a5a6;
            border-radius: 4px;
            font-size: 14px;
        }

        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }

        .btn-primary {
            background: #3498db;
            color: white;
        }

        .btn-primary:hover {
            background: #2980b9;
        }

        .btn-success {
            background: #27ae60;
            color: white;
        }

        .btn-success:hover {
            background: #229954;
        }

        
        .error-message {
            background: #fadbd8;
            color: #e74c3c;
            padding: 10px;
            border-radius: 4px;
            margin: 10px;
            border-left: 4px solid #e74c3c;
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Editor Panel -->
        <div class="panel">
            <div class="header">
                <span>📝 Code Editor</span>
            </div>
            <div class="editor-container">
                <div class="toolbar">
                    <label class="btn btn-primary" style="margin: 0;">
                        📁 Load File
                        <input type="file" id="fileInput" accept=".html,.htm" style="display: none;">
                    </label>
                    <button class="btn btn-primary" id="downloadBtn">⬇️ Download</button>
                    <button class="btn btn-success" id="saveBtn">💾 Save</button>
                    <button class="btn btn-primary" id="previewBtn">▶️ Start Preview</button>
                </div>
                <div class="code-editor-wrapper">
                    <textarea
                        id="codeEditor"
                        class="code-editor"
                        spellcheck="false"
                        placeholder="Loading theme file..."
                    ></textarea>
                    <div id="codeHighlighted" class="code-highlighted"></div>
                </div>
            </div>
        </div>

        <!-- Resizer -->
        <div class="resizer" id="resizer"></div>

        <!-- Preview Panel -->
        <div class="panel">
            <div class="header">
                <span>Live Preview</span>
            </div>
            <div class="preview-container">
                <div class="preview-canvas">
                    <div class="led-grid-container">
                        <canvas id="ledCanvas" width="128" height="64"></canvas>
                    </div>
                </div>
                <div class="controls">
                    <div class="control-group">
                        <label>🔠 Font Size</label>
                        <input type="range" id="fontSize" min="10" max="100" value="60">
                        <span id="fontSizeValue" style="margin-left: 5px; font-size: 12px;">60%</span>
                    </div>
                    <div class="control-group">
                        <label>🎨 Text Color</label>
                        <input type="color" id="textColor" value="#00ff00">
                    </div>
                    <div class="control-group">
                        <label>🖼️ Background Color</label>
                        <input type="color" id="bgColor" value="#000000">
                    </div>
                    <div class="control-group">
                        <label>💡 LED Brightness</label>
                        <input type="range" id="ledBrightness" min="1" max="100" value="80">
                        <span id="brightnessValue" style="margin-left: 5px; font-size: 12px;">80%</span>
                    </div>
                    <div class="control-group">
                        <label>🕐 Time Format</label>
                        <select id="timeFormat">
                            <option value="24">24-hour</option>
                            <option value="12">12-hour</option>
                        </select>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <div class="control-group">
                            <label><input type="checkbox" id="showSeconds" checked> Show Seconds</label>
                        </div>
                        <div class="control-group">
                            <label><input type="checkbox" id="pulseAnimation"> Pulse Effect</label>
                        </div>
                    </div>
                    <div class="control-group">
                        <label>✨ LED Effects</label>
                        <select id="ledEffect">
                            <option value="none">None</option>
                            <option value="glow">Glow</option>
                            <option value="smooth">Smooth Fade</option>
                            <option value="rainbow">Rainbow</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        let ws;
        let currentTheme = null;
        let previewInterval = null;
        const GRID_WIDTH = 128;
        const GRID_HEIGHT = 64;

        const codeEditor = document.getElementById('codeEditor');
        const codeHighlighted = document.getElementById('codeHighlighted');
        const saveBtn = document.getElementById('saveBtn');
        const downloadBtn = document.getElementById('downloadBtn');
        const previewBtn = document.getElementById('previewBtn');
        const ledCanvas = document.getElementById('ledCanvas');
        const fontSizeValue = document.getElementById('fontSizeValue');
        const brightnessValue = document.getElementById('brightnessValue');
        const fileInput = document.getElementById('fileInput');

        const ledCtx = ledCanvas.getContext('2d');
        let themeCanvas, themeCtx;

        // Initialize LED Canvas
        function initializeLEDCanvas() {
            // Create theme canvas for rendering
            themeCanvas = document.createElement('canvas');
            themeCanvas.width = GRID_WIDTH;
            themeCanvas.height = GRID_HEIGHT;
            themeCtx = themeCanvas.getContext('2d');

            // Set up LED canvas for LED effect
            ledCtx.imageSmoothingEnabled = false;
            ledCtx.fillStyle = '#000000';
            ledCtx.fillRect(0, 0, GRID_WIDTH, GRID_HEIGHT);
        }

        // Apply LED effect to canvas
        function applyLEDEffect(imageData, settings) {
            const data = imageData.data;
            const effect = settings.ledEffect;
            const brightness = settings.ledBrightness;

            for (let y = 0; y < GRID_HEIGHT; y++) {
                for (let x = 0; x < GRID_WIDTH; x++) {
                    const i = (y * GRID_WIDTH + x) * 4;
                    let r = data[i];
                    let g = data[i + 1];
                    let b = data[i + 2];
                    let a = data[i + 3];

                    if (a > 0) {
                        // Apply brightness
                        r = Math.floor(r * brightness);
                        g = Math.floor(g * brightness);
                        b = Math.floor(b * brightness);

                        // Apply LED effects
                        if (effect === 'glow') {
                            // Add glow effect for bright pixels
                            if (r > 128 || g > 128 || b > 128) {
                                data[i] = Math.min(255, r + 30);
                                data[i + 1] = Math.min(255, g + 30);
                                data[i + 2] = Math.min(255, b + 30);
                            }
                        } else if (effect === 'smooth') {
                            // Smooth transitions
                            const avg = (r + g + b) / 3;
                            const factor = avg / 255;
                            data[i] = Math.floor(r * (0.7 + factor * 0.3));
                            data[i + 1] = Math.floor(g * (0.7 + factor * 0.3));
                            data[i + 2] = Math.floor(b * (0.7 + factor * 0.3));
                        } else if (effect === 'rainbow') {
                            // Add rainbow cycling
                            const time = Date.now() / 1000;
                            const hue = (x / GRID_WIDTH * 360 + time * 50) % 360;
                            const rgb = hslToRgb(hue / 360, 0.7, 0.5);
                            data[i] = Math.floor((r + rgb[0]) / 2);
                            data[i + 1] = Math.floor((g + rgb[1]) / 2);
                            data[i + 2] = Math.floor((b + rgb[2]) / 2);
                        } else {
                            // Normal effect
                            data[i] = r;
                            data[i + 1] = g;
                            data[i + 2] = b;
                        }
                        data[i + 3] = 255;
                    } else {
                        // Background pixels
                        data[i] = 0;
                        data[i + 1] = 0;
                        data[i + 2] = 0;
                        data[i + 3] = 255;
                    }
                }
            }
            return imageData;
        }

        // HSL to RGB conversion for rainbow effect
        function hslToRgb(h, s, l) {
            let r, g, b;
            if (s === 0) {
                r = g = b = l;
            } else {
                const hue2rgb = (p, q, t) => {
                    if (t < 0) t += 1;
                    if (t > 1) t -= 1;
                    if (t < 1/6) return p + (q - p) * 6 * t;
                    if (t < 1/2) return q;
                    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                    return p;
                };
                const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                const p = 2 * l - q;
                r = hue2rgb(p, q, h + 1/3);
                g = hue2rgb(p, q, h);
                b = hue2rgb(p, q, h - 1/3);
            }
            return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
        }

        // Initialize WebSocket
        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws`;

            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                console.log('WebSocket connected');
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleWebSocketMessage(data);
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };

            ws.onclose = () => {
                console.log('WebSocket disconnected, reconnecting...');
                setTimeout(connectWebSocket, 3000);
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        }

        // Handle WebSocket messages
        function handleWebSocketMessage(data) {
            switch(data.type) {
                case 'theme_loaded':
                    if (data.content) {
                        codeEditor.value = data.content;
                        applySyntaxHighlightingToEditor();
                    }
                    break;
                case 'theme_saved':
                    showSaveSuccess();
                    break;
                case 'error':
                    showError(data.message);
                    break;
            }
        }

        // Store plain text for execution
        let plainCodeText = '';

        // Apply syntax highlighting to editor content
        function applySyntaxHighlightingToEditor() {
            const plainText = codeEditor.value;
            plainCodeText = plainText; // Store for execution
            const highlighted = applySyntaxHighlighting(plainText);
            codeHighlighted.innerHTML = highlighted;

            // Sync scroll positions
            codeHighlighted.scrollTop = codeEditor.scrollTop;
            codeHighlighted.scrollLeft = codeEditor.scrollLeft;
        }

        // Get plain text
        function getPlainText() {
            return codeEditor.value;
        }

        // Simple syntax highlighting for better readability
        function applySyntaxHighlighting(code) {
            // Simple approach - just highlight basic keywords without complex processing
            let highlighted = code
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            // Highlight keywords outside of HTML tags
            const keywords = ['function', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'return', 'new', 'this', 'typeof', 'true', 'false', 'null'];
            keywords.forEach(keyword => {
                const regex = new RegExp(`\\b${keyword}\\b`, 'g');
                highlighted = highlighted.replace(regex, '<span style="color: #569cd6;">$&</span>');
            });

            // Highlight strings
            highlighted = highlighted.replace(/'([^']*)'/g, '<span style="color: #ce9178;">\\'$1\\'</span>');
            highlighted = highlighted.replace(/"([^"]*)"/g, '<span style="color: #ce9178;">"$1"</span>');

            // Highlight numbers
            highlighted = highlighted.replace(/\b(\d+)\b/g, '<span style="color: #b5cea8;">$1</span>');

            // Highlight comments
            highlighted = highlighted.replace(/(\/\/.*$)/gm, '<span style="color: #6a9955;">$1</span>');

            return highlighted;
        }

        // Parse and execute theme
        function parseTheme(code) {
            try {
                // Use plain text, not HTML content
                const cleanCode = getPlainText();
                const scriptMatch = cleanCode.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
                if (!scriptMatch) {
                    throw new Error('No script tag found in theme');
                }

                const scriptCode = scriptMatch[1];
                eval(scriptCode);

                if (typeof themeInit === 'function' && typeof themeRender === 'function') {
                    currentTheme = {
                        init: themeInit,
                        render: themeRender
                    };
                } else {
                    throw new Error('Required theme functions not found');
                }

            } catch (error) {
                showError('Theme parsing error: ' + error.message);
            }
        }

        // Start preview
        function startPreview() {
            if (!currentTheme) {
                parseTheme(codeEditor.textContent);
            }

            if (!currentTheme) {
                showError('Failed to load theme');
                return;
            }

            if (previewInterval) {
                clearInterval(previewInterval);
            }

            let state = {};
            try {
                state = currentTheme.init();
            } catch (error) {
                showError('Theme init error: ' + error.message);
                return;
            }

            const settings = {
                textColor: document.getElementById('textColor').value,
                bgColor: document.getElementById('bgColor').value,
                fontSize: parseInt(document.getElementById('fontSize').value),
                ledBrightness: parseInt(document.getElementById('ledBrightness').value) / 100,
                ledEffect: document.getElementById('ledEffect').value,
                timeFormat: document.getElementById('timeFormat').value,
                showSeconds: document.getElementById('showSeconds').checked,
                pulseAnimation: document.getElementById('pulseAnimation').checked,
                fontFamily: 'Arial, sans-serif',
                fontWeight: 'bold',
                positionX: 0,
                positionY: 0,
                shadowColor: '#004400',
                shadowBlur: 2,
                fadeTransition: true
            };

            if (state.settings) {
                Object.assign(state.settings, settings);
            } else {
                state.settings = settings;
            }

            const render = () => {
                try {
                    // Clear theme canvas
                    themeCtx.fillStyle = settings.bgColor;
                    themeCtx.fillRect(0, 0, GRID_WIDTH, GRID_HEIGHT);

                    // Render theme to theme canvas
                    currentTheme.render(themeCtx, GRID_WIDTH, GRID_HEIGHT, state, Date.now());

                    // Get image data and apply LED effects
                    const imageData = themeCtx.getImageData(0, 0, GRID_WIDTH, GRID_HEIGHT);
                    const processedData = applyLEDEffect(imageData, settings);

                    // Draw to LED canvas
                    ledCtx.putImageData(processedData, 0, 0);

                } catch (error) {
                    console.error('Render error:', error);
                }
            };

            render();
            previewInterval = setInterval(render, 1000); // Update once per second, not 30 FPS

            previewBtn.textContent = 'Stop Preview';
            previewBtn.classList.remove('btn-primary');
            previewBtn.classList.add('btn-success');
        }

        // Stop preview
        function stopPreview() {
            if (previewInterval) {
                clearInterval(previewInterval);
                previewInterval = null;
            }

            // Clear LED canvas
            ledCtx.fillStyle = '#000000';
            ledCtx.fillRect(0, 0, GRID_WIDTH, GRID_HEIGHT);

            previewBtn.textContent = 'Start Preview';
            previewBtn.classList.remove('btn-success');
            previewBtn.classList.add('btn-primary');
        }

        
        previewBtn.addEventListener('click', () => {
            if (previewInterval) {
                stopPreview();
            } else {
                startPreview();
            }
        });

        // File input handler
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const content = e.target.result;
                    codeEditor.value = content;
                    applySyntaxHighlightingToEditor();
                };
                reader.readAsText(file);
            }
        });

        // Download button handler
        downloadBtn.addEventListener('click', () => {
            const content = getPlainText();
            const blob = new Blob([content], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'theme.html';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });

        saveBtn.addEventListener('click', async () => {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                showError('Not connected to server');
                return;
            }

            saveBtn.textContent = 'Saving...';
            ws.send(JSON.stringify({
                type: 'save',
                content: getPlainText()
            }));
        });

        // Update value displays
        document.getElementById('fontSize').addEventListener('input', (e) => {
            fontSizeValue.textContent = e.target.value + '%';
            if (previewInterval) startPreview();
        });

        document.getElementById('ledBrightness').addEventListener('input', (e) => {
            brightnessValue.textContent = e.target.value + '%';
            if (previewInterval) startPreview();
        });

        // Preview controls
        document.getElementById('textColor').addEventListener('input', () => {
            if (previewInterval) startPreview();
        });
        document.getElementById('bgColor').addEventListener('input', () => {
            if (previewInterval) startPreview();
        });
        document.getElementById('timeFormat').addEventListener('change', startPreview);
        document.getElementById('showSeconds').addEventListener('change', startPreview);
        document.getElementById('pulseAnimation').addEventListener('change', startPreview);
        document.getElementById('ledEffect').addEventListener('change', startPreview);

        // Live syntax highlighting
        codeEditor.addEventListener('input', () => {
            setTimeout(applySyntaxHighlightingToEditor, 100);
        });

        // Sync scroll between textarea and highlighted layer
        codeEditor.addEventListener('scroll', () => {
            codeHighlighted.scrollTop = codeEditor.scrollTop;
            codeHighlighted.scrollLeft = codeEditor.scrollLeft;
        });

        // Ctrl+S save shortcut
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                saveBtn.click();
            }
        });

        // Resizer functionality
        const resizer = document.getElementById('resizer');
        const container = document.querySelector('.container');
        let isResizing = false;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizer.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            const containerRect = container.getBoundingClientRect();
            const mouseX = e.clientX - containerRect.left;
            const containerWidth = containerRect.width;

            // Calculate percentage (min 20%, max 80% for left panel)
            let leftPanelWidth = (mouseX / containerWidth) * 100;
            leftPanelWidth = Math.max(20, Math.min(80, leftPanelWidth));

            // Apply new sizes
            const leftPanel = container.firstElementChild;
            const rightPanel = container.lastElementChild;

            leftPanel.style.flex = `0 0 ${leftPanelWidth}%`;
            rightPanel.style.flex = `0 0 ${100 - leftPanelWidth}%`;
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });

        // Helper functions
        function showSaveSuccess() {
            saveBtn.textContent = 'Saved!';
            setTimeout(() => {
                saveBtn.textContent = 'Save';
            }, 2000);
        }

        function showError(message) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            errorDiv.textContent = 'Error: ' + message;
            errorDiv.style.position = 'fixed';
            errorDiv.style.top = '20px';
            errorDiv.style.left = '50%';
            errorDiv.style.transform = 'translateX(-50%)';
            errorDiv.style.zIndex = '9999';

            document.body.appendChild(errorDiv);

            setTimeout(() => {
                document.body.removeChild(errorDiv);
            }, 5000);
        }

        // Initialize
        connectWebSocket();

        // Initialize LED canvas and load theme when page loads
        window.addEventListener('load', () => {
            initializeLEDCanvas();
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    // Load default theme file
                    loadDefaultFile();
                    // Auto-start preview after a short delay
                    setTimeout(() => {
                        previewBtn.click();
                    }, 2000);
                }
            }, 1000);
        });

        // Load default theme file
        function loadDefaultFile() {
            const defaultFilePath = '/home/acleda/Documents/PlatformIO/Projects/esp_khmer_text/theme_clock_test_template.html';
            ws.send(JSON.stringify({
                type: 'load_path',
                file_path: defaultFilePath
            }));
        }
    </script>
</body>
</html>
    """

@app.get("/load")
async def load_theme():
    """Load the current theme file"""
    try:
        if not os.path.exists(THEME_FILE_PATH):
            raise HTTPException(status_code=404, detail="Theme file not found")

        async with aiofiles.open(THEME_FILE_PATH, 'r') as f:
            content = await f.read()

        return {"content": content, "filename": os.path.basename(THEME_FILE_PATH)}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/load_path")
async def load_theme_by_path(data: dict):
    """Load theme from specific file path"""
    try:
        file_path = data.get("file_path", "")
        if not file_path or not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="File not found")

        async with aiofiles.open(file_path, 'r') as f:
            content = await f.read()

        return {"content": content, "filename": os.path.basename(file_path), "path": file_path}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/save")
async def save_theme(data: dict):
    """Save the theme file"""
    try:
        content = data.get("content", "")
        file_path = data.get("file_path", THEME_FILE_PATH)

        async with aiofiles.open(file_path, 'w') as f:
            await f.write(content)

        return {"message": f"File {os.path.basename(file_path)} saved successfully"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates"""
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            if message.get("type") == "load":
                try:
                    theme_data = await load_theme()
                    await manager.send_personal_message(json.dumps({
                        "type": "theme_loaded",
                        **theme_data
                    }), websocket)
                except Exception as e:
                    await manager.send_personal_message(json.dumps({
                        "type": "error",
                        "message": str(e)
                    }), websocket)

            elif message.get("type") == "load_path":
                try:
                    theme_data = await load_theme_by_path(message)
                    await manager.send_personal_message(json.dumps({
                        "type": "theme_loaded",
                        **theme_data
                    }), websocket)
                except Exception as e:
                    await manager.send_personal_message(json.dumps({
                        "type": "error",
                        "message": str(e)
                    }), websocket)

            elif message.get("type") == "save":
                try:
                    result = await save_theme(message)
                    await manager.send_personal_message(json.dumps({
                        "type": "theme_saved",
                        **result
                    }), websocket)
                except Exception as e:
                    await manager.send_personal_message(json.dumps({
                        "type": "error",
                        "message": str(e)
                    }), websocket)

    except WebSocketDisconnect:
        manager.disconnect(websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)