const svg = document.getElementById('whiteboard');
const toolbar = document.getElementById('toolbar');

let isDrawing = false;
let currentPath;
let startX, startY; // For shape drawing
let currentShape; // For shape drawing

const penBtn = document.getElementById('pen');
const eraserBtn = document.getElementById('eraser');
const colorPicker = document.getElementById('colorPicker');
const brushSize = document.getElementById('brushSize');
const undoBtn = document.getElementById('undo');
const redoBtn = document.getElementById('redo');
const panModeBtn = document.getElementById('pan-mode');
const zoomSlider = document.getElementById('zoom-slider');
const zoomValueDisplay = document.getElementById('zoom-value-display');
const toggleGridBtn = document.getElementById('toggle-grid');
const shapeSelect = document.getElementById('shape-select');

let strokeColor = colorPicker.value;
let strokeWeight = brushSize.value;

let panX = 0;
let panY = 0;
let scale = 1;

let isPanning = false;
let panMode = false;
let startPanX = 0;
let startPanY = 0;

let currentTool = 'pen'; // 'pen', 'eraser', or 'select'
let isErasing = false;
let isSelecting = false; // New state for selection
let selectionRect = null; // The SVG rectangle for selection
let selectedElements = []; // Array to store selected SVG elements
let startSelectX, startSelectY; // Starting coordinates for selection rectangle
let isMovingSelection = false; // New state for moving selected elements
let startDragSVGX, startDragSVGY; // Store initial SVG coordinates for drag

let showGrid = true;

let lastDynamicZoomOption = null;

function getTransformedBBox(element) {
  const svg = element.ownerSVGElement;
  if (!svg) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const bbox = element.getBBox(); // Untransformed bounding box
  const ctm = element.getCTM(); // Transformation matrix to SVG space
  const svgPoint = svg.createSVGPoint();

  // Function to transform a point
  const transformPoint = (x, y) => {
    svgPoint.x = x;
    svgPoint.y = y;
    return svgPoint.matrixTransform(ctm);
  };

  // Get the four corners of the untransformed bbox
  const corners = [
    transformPoint(bbox.x, bbox.y),
    transformPoint(bbox.x + bbox.width, bbox.y),
    transformPoint(bbox.x + bbox.width, bbox.y + bbox.height),
    transformPoint(bbox.x, bbox.y + bbox.height)
  ];

  // Find the min/max x and y from the transformed corners
  const minX = Math.min(...corners.map(p => p.x));
  const maxX = Math.max(...corners.map(p => p.x));
  const minY = Math.min(...corners.map(p => p.y));
  const maxY = Math.max(...corners.map(p => p.y));
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function deselectAllElements() {
    selectedElements.forEach(element => {
        element.classList.remove('selected');
    });
    selectedElements = [];
}

function updateViewBox() {
    const viewBox = `${panX} ${panY} ${svg.clientWidth / scale} ${svg.clientHeight / scale}`;
    svg.setAttribute('viewBox', viewBox);
    drawGrid();
}

let gridGroup;
const baseGridSizes = [10, 50, 100, 500]; // Different grid densities in SVG units
const idealScreenGridSize = 75; // Ideal screen size in pixels for a grid line to be fully visible

function drawGrid() {
    console.log('drawGrid - showGrid:', showGrid);
    // Remove all existing grid groups
    const existingGridGroups = svg.querySelectorAll('g[data-grid-level]');
    existingGridGroups.forEach(group => group.remove());

    if (!showGrid) return;

    baseGridSizes.forEach(baseGridSize => {
        const currentScreenGridSize = baseGridSize * scale;

        // Calculate opacity using a bell-shaped function
        // This function makes grid lines most visible when their screen size is close to idealScreenGridSize
        // and fades them out as they get further away.
        const opacity = Math.exp(-Math.pow((currentScreenGridSize - idealScreenGridSize) / (idealScreenGridSize * 0.5), 2));

        if (opacity < 0.01) return; // Don't draw if too transparent

        const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        gridGroup.setAttribute('stroke', '#a0a0a0'); // Made darker for visibility
        gridGroup.setAttribute('stroke-width', 2 / scale); // Made thicker for visibility
        gridGroup.setAttribute('opacity', opacity);
        gridGroup.setAttribute('data-grid-level', baseGridSize); // Mark for easy removal

        const adjustedGridSize = baseGridSize; // Grid lines are drawn at their base size

        const startX = Math.floor(panX / adjustedGridSize) * adjustedGridSize;
        const endX = panX + svg.clientWidth / scale;
        for (let x = startX; x < endX; x += adjustedGridSize) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x);
            line.setAttribute('y1', panY);
            line.setAttribute('x2', x);
            line.setAttribute('y2', panY + svg.clientHeight / scale);
            gridGroup.appendChild(line);
        }

        const startY = Math.floor(panY / adjustedGridSize) * adjustedGridSize;
        const endY = panY + svg.clientHeight / scale;
        for (let y = startY; y < endY; y += adjustedGridSize) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', panX);
            line.setAttribute('y1', y);
            line.setAttribute('x2', panX + svg.clientWidth / scale);
            line.setAttribute('y2', y);
            gridGroup.appendChild(line);
        }
        svg.prepend(gridGroup); // Add grid to the beginning so it's behind drawings
    });
}

function startDrawing(e) {
    console.log('startDrawing - currentTool:', currentTool);

    if (e.button === 1 || panMode) { // Middle mouse button or pan mode active
        isPanning = true;
        startPanX = e.clientX;
        startPanY = e.clientY;
        console.log('startDrawing - Panning mode active');
        return;
    }

    pt = toSVGPoint(e.clientX, e.clientY);

    // Priority 1: Moving Selected Elements
    if (currentTool === 'select' && selectedElements.length > 0) {
        let clickedOnSelected = false;
        for (const element of selectedElements) {
            try {
                const bbox = getTransformedBBox(element);
                if (pt.x >= bbox.x && pt.x <= bbox.x + bbox.width &&
                    pt.y >= bbox.y && pt.y <= bbox.y + bbox.height) {
                    clickedOnSelected = true;
                    break;
                }
            } catch (error) {
                console.warn("Could not get BBox for element during click check:", element, error);
            }
        }
        if (clickedOnSelected) {
            isMovingSelection = true;
            startDragSVGX = pt.x; // Store initial SVG X for drag
            startDragSVGY = pt.y; // Store initial SVG Y for drag
            selectedElements.forEach(element => {
                const consolidatedTransform = element.transform.baseVal.consolidate();
                element._initialMatrix = consolidatedTransform ? consolidatedTransform.matrix : svg.createSVGMatrix();
            });
            console.log('startDrawing - Moving selected element');
            return;
        }
    }

    // Priority 2: Starting a New Selection
    if (currentTool === 'select') {
        isSelecting = true;
        startSelectX = pt.x;
        startSelectY = pt.y;

        // Deselect all if clicking outside current selection
        if (selectedElements.length > 0) {
            deselectAllElements();
        }

        selectionRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        selectionRect.setAttribute('x', startSelectX);
        selectionRect.setAttribute('y', startSelectY);
        selectionRect.setAttribute('width', 0);
        selectionRect.setAttribute('height', 0);
        selectionRect.setAttribute('fill', 'rgba(0, 0, 255, 0.1)');
        selectionRect.setAttribute('stroke', 'blue');
        selectionRect.setAttribute('stroke-width', 1 / scale);
        svg.appendChild(selectionRect);
        console.log('startDrawing - Starting new selection. startSelectX:', startSelectX, 'startSelectY:', startSelectY);
        return;
    }

    // Priority 3: Drawing or Erasing
    if (currentTool === 'eraser') {
        isErasing = true;
        erase(e);
        console.log('startDrawing - Erasing mode active');
        return;
    }

    if (currentTool === 'arrow') {
        isDrawing = true;
        pt = toSVGPoint(e.clientX, e.clientY);
        startX = pt.x;
        startY = pt.y;
        currentShape = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        currentShape.setAttribute('x1', startX);
        currentShape.setAttribute('y1', startY);
        currentShape.setAttribute('x2', startX);
        currentShape.setAttribute('y2', startY);
        currentShape.setAttribute('stroke', strokeColor);
        currentShape.setAttribute('stroke-width', strokeWeight / scale);
        currentShape.setAttribute('marker-end', 'url(#arrowhead)');
        svg.appendChild(currentShape);
        return;
    }

    if (currentTool === 'circle') {
        isDrawing = true;
        pt = toSVGPoint(e.clientX, e.clientY);
        startX = pt.x;
        startY = pt.y;
        currentShape = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        currentShape.setAttribute('cx', startX);
        currentShape.setAttribute('cy', startY);
        currentShape.setAttribute('r', 0);
        currentShape.setAttribute('fill', 'none');
        currentShape.setAttribute('stroke', strokeColor);
        currentShape.setAttribute('stroke-width', strokeWeight / scale);
        svg.appendChild(currentShape);
        return;
    }

    if (currentTool === 'ellipse') {
        isDrawing = true;
        pt = toSVGPoint(e.clientX, e.clientY);
        startX = pt.x;
        startY = pt.y;
        currentShape = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        currentShape.setAttribute('cx', startX);
        currentShape.setAttribute('cy', startY);
        currentShape.setAttribute('rx', 0);
        currentShape.setAttribute('ry', 0);
        currentShape.setAttribute('fill', 'none');
        currentShape.setAttribute('stroke', strokeColor);
        currentShape.setAttribute('stroke-width', strokeWeight / scale);
        svg.appendChild(currentShape);
        return;
    }

    if (currentTool === 'rectangle') {
        isDrawing = true;
        pt = toSVGPoint(e.clientX, e.clientY);
        startX = pt.x;
        startY = pt.y;
        currentShape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        currentShape.setAttribute('x', startX);
        currentShape.setAttribute('y', startY);
        currentShape.setAttribute('width', 0);
        currentShape.setAttribute('height', 0);
        currentShape.setAttribute('fill', 'none');
        currentShape.setAttribute('stroke', strokeColor);
        currentShape.setAttribute('stroke-width', strokeWeight / scale);
        svg.appendChild(currentShape);
        return;
    }

    if (currentTool === 'square') {
        isDrawing = true;
        pt = toSVGPoint(e.clientX, e.clientY);
        startX = pt.x;
        startY = pt.y;
        currentShape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        currentShape.setAttribute('x', startX);
        currentShape.setAttribute('y', startY);
        currentShape.setAttribute('width', 0);
        currentShape.setAttribute('height', 0);
        currentShape.setAttribute('fill', 'none');
        currentShape.setAttribute('stroke', strokeColor);
        currentShape.setAttribute('stroke-width', strokeWeight / scale);
        svg.appendChild(currentShape);
        return;
    }

    isDrawing = true;
    pt = toSVGPoint(e.clientX, e.clientY);
    points = [[pt.x, pt.y]];
    currentPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    currentPath.setAttribute('fill', 'none');
    currentPath.setAttribute('stroke', strokeColor);
    currentPath.setAttribute('stroke-width', strokeWeight / scale);
    currentPath.setAttribute('stroke-linecap', 'round');
    currentPath.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(currentPath);
}

function disableSvgInteractions() {
    svg.removeEventListener('mousedown', startDrawing);
    svg.removeEventListener('mousemove', draw);
    svg.removeEventListener('mouseup', stopDrawing);
    svg.removeEventListener('mouseleave', stopDrawing);
    svg.removeEventListener('wheel', zoom);
}

function enableSvgInteractions() {
    svg.addEventListener('mousedown', startDrawing);
    svg.addEventListener('mousemove', draw);
    svg.addEventListener('mouseup', stopDrawing);
    svg.addEventListener('mouseleave', stopDrawing);
    svg.addEventListener('wheel', zoom);
}

function draw(e) {
    console.log('draw - currentTool:', currentTool, 'isDrawing:', isDrawing);

    if (isPanning) {
        const dx = (e.clientX - startPanX) / scale;
        const dy = (e.clientY - startPanY) / scale;
        panX -= dx;
        panY -= dy;
        updateViewBox();
        startPanX = e.clientX;
        startPanY = e.clientY;
        return;
    }

    if (isMovingSelection) {
        const currentSVGPoint = toSVGPoint(e.clientX, e.clientY);
        const totalDx = currentSVGPoint.x - startDragSVGX;
        const totalDy = currentSVGPoint.y - startDragSVGY;

        // Ensure totalDx and totalDy are finite numbers
        if (!isFinite(totalDx) || !isFinite(totalDy)) {
            console.warn("Invalid totalDx or totalDy value during movement:", totalDx, totalDy);
            return; // Skip transformation for this frame
        }

        selectedElements.forEach(element => {
            const initialMatrix = element._initialMatrix;
            const newMatrix = initialMatrix.translate(totalDx, totalDy);
            element.transform.baseVal.initialize(svg.createSVGTransformFromMatrix(newMatrix));
            console.log('draw - Moving element. totalDx:', totalDx, 'totalDy:', totalDy, 'matrix:', newMatrix.a, newMatrix.b, newMatrix.c, newMatrix.d, newMatrix.e, newMatrix.f);
        });
        return;
    }

    if (isErasing) {
        erase(e);
        return;
    }

    if (isSelecting) {
        pt = toSVGPoint(e.clientX, e.clientY);
        const x = Math.min(startSelectX, pt.x);
        const y = Math.min(startSelectY, pt.y);
        const width = Math.abs(pt.x - startSelectX);
        const height = Math.abs(pt.y - startSelectY);

        selectionRect.setAttribute('x', x);
        selectionRect.setAttribute('y', y);
        selectionRect.setAttribute('width', width);
        selectionRect.setAttribute('height', height);
        console.log('draw - Selecting. x:', x, 'y:', y, 'width:', width, 'height:', height);
        return;
    }

    if (!isDrawing) return; // Only proceed if a drawing tool is active

    pt = toSVGPoint(e.clientX, e.clientY);

    if (currentTool === 'square') {
        const width = Math.abs(pt.x - startX);
        const height = Math.abs(pt.y - startY);
        const size = Math.max(width, height); // Ensure 1:1 aspect ratio

        currentShape.setAttribute('x', Math.min(startX, startX + (pt.x > startX ? size : -size)));
        currentShape.setAttribute('y', Math.min(startY, startY + (pt.y > startY ? size : -size)));
        currentShape.setAttribute('width', size);
        currentShape.setAttribute('height', size);
        return;
    }

    if (currentTool === 'rectangle') {
        const width = Math.abs(pt.x - startX);
        const height = Math.abs(pt.y - startY);

        currentShape.setAttribute('x', Math.min(startX, pt.x));
        currentShape.setAttribute('y', Math.min(startY, pt.y));
        currentShape.setAttribute('width', width);
        currentShape.setAttribute('height', height);
        return;
    }

    if (currentTool === 'circle') {
        const radius = Math.sqrt(Math.pow(pt.x - startX, 2) + Math.pow(pt.y - startY, 2));
        currentShape.setAttribute('r', radius);
        return;
    }

    if (currentTool === 'ellipse') {
        const rx = Math.abs(pt.x - startX);
        const ry = Math.abs(pt.y - startY);
        currentShape.setAttribute('rx', rx);
        currentShape.setAttribute('ry', ry);
        return;
    }

    if (currentTool === 'arrow') {
        currentShape.setAttribute('x2', pt.x);
        currentShape.setAttribute('y2', pt.y);
        return;
    }

    points.push([pt.x, pt.y]);
    currentPath.setAttribute('d', generatePath(points));
}

function erase(e) {
    pt = toSVGPoint(e.clientX, e.clientY);
    const eraserSize = strokeWeight * 2 / scale; // Use eraser size based on brush size

    console.log('Erase - Mouse Pt:', pt.x, pt.y);

    const elements = Array.from(svg.children);
    for (let i = elements.length - 1; i >= 0; i--) {
        const element = elements[i];
        // Only consider path elements that are not grid lines
        if (element.tagName === 'path' && !element.hasAttribute('data-grid-level')) {
            try {
                const bbox = element.getBBox();
                console.log('Erase - Element BBox:', bbox.x, bbox.y, bbox.width, bbox.height, 'Element:', element);
                if (pt.x > bbox.x - eraserSize && pt.x < bbox.x + bbox.width + eraserSize &&
                    pt.y > bbox.y - eraserSize && pt.y < bbox.y + bbox.height + eraserSize) {
                    element.remove();
                }
            } catch (error) {
                console.warn("Could not get BBox for element during erase:", element, error);
            }
        }
    }
}

function stopDrawing(e) {
    console.log('stopDrawing - currentTool:', currentTool, 'isDrawing:', isDrawing);

    if (e.button === 1 || panMode) {
        isPanning = false;
        return;
    }

    if (isMovingSelection) {
        isMovingSelection = false;
        saveState(); // Save state after moving selected elements
        selectedElements.forEach(element => {
            element._initialMatrix = null; // Clean up initial matrix
        });
        return;
    }

    if (isSelecting) {
        isSelecting = false;
        if (selectionRect && selectionRect.parentNode) {
            const rectBBox = selectionRect.getBBox();
            selectionRect.remove();
            selectedElements = [];

            // Force a reflow to ensure CTMs are up-to-date
            svg.offsetWidth; 

            const allElements = Array.from(svg.children);
            console.log('stopDrawing - Selection Rect BBox:', rectBBox.x, rectBBox.y, rectBBox.width, rectBBox.height);
            allElements.forEach(element => {
                // Exclude grid lines, the selection rectangle itself
                if (element !== selectionRect && !element.hasAttribute('data-grid-level')) {
                    try {
                        const transformedBBox = getTransformedBBox(element);

                        console.log('stopDrawing - Element BBox (transformed):', transformedBBox.x, transformedBBox.y, transformedBBox.width, transformedBBox.height, 'Element:', element);
                        // Check for intersection
                        if (rectBBox.x < transformedBBox.x + transformedBBox.width &&
                            rectBBox.x + rectBBox.width > transformedBBox.x &&
                            rectBBox.y < transformedBBox.y + transformedBBox.height &&
                            rectBBox.y + rectBBox.height > transformedBBox.y) {
                            selectedElements.push(element);
                            element.classList.add('selected'); // Add a class for styling
                        }
                    } catch (error) {
                        console.warn("Could not get BBox for element:", element, error);
                    }
                }
            });
            // If no elements are selected, clear any existing selection
            if (selectedElements.length === 0) {
                deselectAllElements();
            }
        }
        saveState(); // Save state after selection
        return;
    }

    if (currentTool === 'square' && isDrawing) {
        isDrawing = false;
        saveState();
        return;
    }

    if (currentTool === 'rectangle' && isDrawing) {
        isDrawing = false;
        saveState();
        return;
    }

    if (currentTool === 'circle' && isDrawing) {
        isDrawing = false;
        saveState();
        return;
    }

    if (currentTool === 'ellipse' && isDrawing) {
        isDrawing = false;
        saveState();
        return;
    }

    if (currentTool === 'arrow' && isDrawing) {
        isDrawing = false;
        saveState();
        return;
    }
    isDrawing = false;
    isErasing = false;
    saveState();
}

function generatePath(points) {
    let d = `M ${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length; i++) {
        d += ` L ${points[i][0]} ${points[i][1]}`;
    }
    return d;
}

function zoom(e) {
    e.preventDefault();
    const zoomFactor = 1.1;
    const { clientX, clientY, deltaY } = e;
    const { left, top } = svg.getBoundingClientRect();
    const x = clientX - left;
    const y = clientY - top;

    const oldScale = scale;
    let newScale = scale * (deltaY > 0 ? 1 / zoomFactor : zoomFactor);
    if (newScale < 0.1) newScale = 0.1;
    if (newScale > 3) newScale = 3;
    scale = newScale;

    panX += (x / oldScale) - (x / scale);
    panY += (y / oldScale) - (y / scale);

    updateViewBox();
    updateZoomDisplayAndDropdown();
    console.log('zoom - panX:', panX, 'panY:', panY, 'scale:', scale);
}

function toSVGPoint(x, y) {
    const pt = svg.createSVGPoint();
    pt.x = x;
    pt.y = y;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function updateZoomDisplayAndDropdown() {
    const roundedScale = Math.round(scale * 100);

    // Check if the current roundedScale is one of the preset options
    let isPreset = false;
    for (let i = 0; i < zoomValueDisplay.options.length; i++) {
        if (parseInt(zoomValueDisplay.options[i].value) === roundedScale) {
            isPreset = true;
            break;
        }
    }

    // Remove the previously added dynamic option if it exists
    if (lastDynamicZoomOption && lastDynamicZoomOption.parentNode) {
        lastDynamicZoomOption.parentNode.removeChild(lastDynamicZoomOption);
        lastDynamicZoomOption = null;
    }

    if (!isPreset) {
        const newOption = document.createElement('option');
        newOption.value = roundedScale;
        newOption.textContent = `${roundedScale}%`;
        zoomValueDisplay.appendChild(newOption);
        lastDynamicZoomOption = newOption;
    }

    zoomValueDisplay.value = roundedScale;
    zoomSlider.value = roundedScale;
}

svg.addEventListener('mousedown', startDrawing);
svg.addEventListener('mousemove', draw);
svg.addEventListener('mouseup', stopDrawing);
svg.addEventListener('mouseleave', stopDrawing);
svg.addEventListener('wheel', zoom);

penBtn.addEventListener('click', () => {
    currentTool = 'pen';
    strokeColor = colorPicker.value;
    strokeWeight = brushSize.value;
});

eraserBtn.addEventListener('click', () => {
    currentTool = 'eraser';
    // Eraser uses a fixed white color, but its size is based on brushSize
    strokeColor = '#ffffff'; // This will be ignored by the eraser logic, but good for consistency
    strokeWeight = brushSize.value * 2;
});

colorPicker.addEventListener('change', (e) => {
    strokeColor = e.target.value;
});

brushSize.addEventListener('input', (e) => {
    strokeWeight = e.target.value;
});

let history = [];
let historyIndex = -1;

function saveState() {
    history = Array.from(svg.children);
    historyIndex = history.length - 1;
}

function undo() {
    if (historyIndex >= 0) {
        svg.removeChild(history[historyIndex]);
        historyIndex--;
    }
}

function redo() {
    if (historyIndex < history.length - 1) {
        historyIndex++;
        svg.appendChild(history[historyIndex]);
    }
}

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

panModeBtn.addEventListener('click', () => {
    panMode = !panMode;
    panModeBtn.textContent = panMode ? 'Drawing' : 'Pan';
});

const selectBtn = document.getElementById('select-tool');

toggleGridBtn.addEventListener('click', () => {
    showGrid = !showGrid;
    drawGrid();
});

shapeSelect.addEventListener('change', (e) => {
    currentTool = e.target.value; // Set currentTool to the selected shape
});

zoomSlider.addEventListener('input', (e) => {
    const newScale = parseFloat(e.target.value) / 100;
    const oldScale = scale;
    scale = newScale;

    // Adjust pan to keep the center of the view the same
    const centerX = panX + (svg.clientWidth / oldScale) / 2;
    const centerY = panY + (svg.clientHeight / oldScale) / 2;

    panX = centerX - (svg.clientWidth / scale) / 2;
    panY = centerY - (svg.clientHeight / scale) / 2;

    updateViewBox();
    updateZoomDisplayAndDropdown();
});

zoomValueDisplay.addEventListener('change', (e) => {
    const newScale = parseFloat(e.target.value) / 100;
    const oldScale = scale;
    scale = newScale;

    const centerX = panX + (svg.clientWidth / oldScale) / 2;
    const centerY = panY + (svg.clientHeight / oldScale) / 2;

    panX = centerX - (svg.clientWidth / scale) / 2;
    panY = centerY - (svg.clientHeight / scale) / 2;

    updateViewBox();
    updateZoomDisplayAndDropdown();
});

svg.addEventListener('mouseup', saveState);

window.addEventListener('load', () => {
    updateViewBox();
    updateZoomDisplayAndDropdown();

    const selectBtn = document.getElementById('select-tool');
    selectBtn.addEventListener('click', () => {
        currentTool = 'select';
        deselectAllElements(); // Deselect any previously selected elements
    });
});
window.addEventListener('resize', updateViewBox);

chatSend.addEventListener('click', () => {
    const message = chatInput.value.trim();
    if (message !== '') {
        appendMessage("You: " + message);
        chatInput.value = '';

        // Send to backend
        fetch('/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message: message })
        })
        .then(response => response.json())
        .then(data => {
            appendMessage("Bot: " + data.reply);
        })
        .catch(error => {
            console.error('Error:', error);
        });
    }
});

function appendMessage(text) {
    const msgDiv = document.createElement('div');
    msgDiv.textContent = text;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showChat() {
    const chatPane = document.getElementById('chat-pane');
    const pdfPane = document.getElementById('pdf-pane');

    chatPane.classList.toggle('open');
    pdfPane.classList.remove('open');
}

function showPDF() {
    const chatPane = document.getElementById('chat-pane');
    const pdfPane = document.getElementById('pdf-pane');

    pdfPane.classList.toggle('open');
    chatPane.classList.remove('open');
}


function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    if (message === '') return;

    const useContext = document.getElementById('contextToggle').checked;

    // Append your own message
    const chatBox = document.getElementById('chatBox');
    const userMsgDiv = document.createElement('div');
    userMsgDiv.textContent = 'You: ' + message;
    chatBox.appendChild(userMsgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;

    // Clear input box
    input.value = '';

    // Send to backend with useContext flag
    fetch('/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            message: message,
            use_context: useContext
        })
    })
    .then(response => response.json())
    .then(data => {
        const botMsgDiv = document.createElement('div');
        botMsgDiv.textContent = 'Bot: ' + data.reply;
        chatBox.appendChild(botMsgDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    })
    .catch(error => {
        console.error('Error:', error);
    });
}
