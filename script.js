const colorOptions = [
    { id: 'red', label: '빨강', hex: '#ef4444', defaultLine: '1호선' },
    { id: 'orange', label: '주황', hex: '#f59e0b', defaultLine: '2호선' },
    { id: 'yellow', label: '노랑', hex: '#facc15', defaultLine: '3호선' },
    { id: 'green', label: '초록', hex: '#22c55e', defaultLine: '4호선' },
    { id: 'blue', label: '파랑', hex: '#3b82f6', defaultLine: '5호선' },
    { id: 'navy', label: '남색', hex: '#1d4ed8', defaultLine: '6호선' },
    { id: 'purple', label: '보라', hex: '#a855f7', defaultLine: '7호선' },
    { id: 'black', label: '검정', hex: '#111827', defaultLine: '8호선' }
];

const canvas = document.getElementById('drawingCanvas');
const ctx = canvas.getContext('2d');
const colorPalette = document.getElementById('colorPalette');
const lineNameInput = document.getElementById('lineNameInput');
const stationNameInput = document.getElementById('stationNameInput');
const saveSlotSelect = document.getElementById('saveSlotSelect');
const deleteBtn = document.getElementById('deleteBtn');
const trainBtn = document.getElementById('trainBtn');
const newMapBtn = document.getElementById('newMapBtn');
const saveMapBtn = document.getElementById('saveMapBtn');
const loadMapBtn = document.getElementById('loadMapBtn');
const legendToggleBtn = document.getElementById('legendToggleBtn');
const lineLegend = document.getElementById('lineLegend');
const STORAGE_PREFIX = 'makeMetroSavedMapSlot';

const state = {
    activeColor: colorOptions[0].hex,
    mode: 'freehand',
    lines: [],
    stations: [],
    selectedLineId: null,
    selectedStationId: null,
    currentDraft: null,
    lineNames: {},
    trainRunning: false,
    trainProgress: 0,
    trainFrameId: null,
    trainPauseUntil: null,
    trainLastStationId: null,
    dpr: 1
};

function updateLegend() {
    const items = colorOptions.map((color) => {
        const name = state.lineNames[color.hex] || color.defaultLine;
        return `<div><span class="color-chip" style="background:${color.hex}"></span>${color.label}: ${name}</div>`;
    }).join('');
    lineLegend.innerHTML = `
        <div class="legend-header">
            <strong>호선 안내</strong>
            <button type="button" class="legend-close-btn" id="legendCloseBtn" aria-label="닫기">✕</button>
        </div>
        ${items}
    `;
    const closeBtn = document.getElementById('legendCloseBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            lineLegend.classList.remove('open');
            if (legendToggleBtn) {
                legendToggleBtn.classList.remove('active');
            }
        });
    }
}

function setActiveColor(colorHex) {
    state.activeColor = colorHex;
    const match = colorOptions.find((entry) => entry.hex === colorHex);
    if (match) {
        lineNameInput.value = state.lineNames[colorHex] || match.defaultLine;
    }
    document.querySelectorAll('.color-btn').forEach((button) => {
        button.classList.toggle('active', button.dataset.color === colorHex);
    });
    updateLegend();
}

function setMode(nextMode) {
    state.mode = nextMode;
    if (nextMode === 'station') {
        state.selectedStationId = null;
        state.selectedLineId = null;
    }
    document.querySelectorAll('.mode-btn').forEach((button) => {
        button.classList.toggle('active', button.dataset.mode === nextMode);
    });
}

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    state.dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * state.dpr;
    canvas.height = rect.height * state.dpr;
    ctx.resetTransform();
    ctx.scale(state.dpr, state.dpr);
    render();
}

function getPointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) {
        return Math.hypot(px - x1, py - y1);
    }

    const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
    const clampedT = Math.max(0, Math.min(1, t));
    const closestX = x1 + clampedT * dx;
    const closestY = y1 + clampedT * dy;
    return Math.hypot(px - closestX, py - closestY);
}

function findNearestPointOnLine(px, py, points) {
    let best = points[0];
    let bestDistance = Infinity;

    for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (dx === 0 && dy === 0) {
            const d = Math.hypot(px - a.x, py - a.y);
            if (d < bestDistance) {
                bestDistance = d;
                best = { x: a.x, y: a.y };
            }
            continue;
        }

        const t = ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy);
        const clampedT = Math.max(0, Math.min(1, t));
        const x = a.x + clampedT * dx;
        const y = a.y + clampedT * dy;
        const d = Math.hypot(px - x, py - y);
        if (d < bestDistance) {
            bestDistance = d;
            best = { x, y };
        }
    }

    return best;
}

function findLineAtPoint(x, y) {
    for (let i = state.lines.length - 1; i >= 0; i -= 1) {
        const line = state.lines[i];
        for (let j = 0; j < line.points.length - 1; j += 1) {
            const a = line.points[j];
            const b = line.points[j + 1];
            if (distanceToSegment(x, y, a.x, a.y, b.x, b.y) <= 10) {
                return line.id;
            }
        }
    }
    return null;
}

function findStationAtPoint(x, y) {
    for (let i = state.stations.length - 1; i >= 0; i -= 1) {
        const station = state.stations[i];
        if (Math.hypot(x - station.x, y - station.y) <= 12) {
            return station.id;
        }
    }
    return null;
}

function findContinuationStart(x, y, color) {
    const sameColorLines = state.lines.filter((line) => line.color === color);
    for (let i = sameColorLines.length - 1; i >= 0; i -= 1) {
        const line = sameColorLines[i];
        const lastPoint = line.points[line.points.length - 1];
        if (Math.hypot(x - lastPoint.x, y - lastPoint.y) <= 18) {
            return line;
        }
    }
    return null;
}

function drawPath(points, color, width = 5, dashed = false) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (dashed) {
        ctx.setLineDash([6, 6]);
    } else {
        ctx.setLineDash([]);
    }
    ctx.stroke();
}

function setTrainBtnState(running) {
    const desktopText = trainBtn.querySelector('.desktop-text');
    const mobileText = trainBtn.querySelector('.mobile-text');
    if (desktopText) desktopText.textContent = running ? '시범 운행 중지' : '시범 운행';
    if (mobileText) mobileText.textContent = running ? '중지' : '운행';
    trainBtn.classList.toggle('active', running);
}

function createBlankMap() {
    state.lines = [];
    state.stations = [];
    state.selectedLineId = null;
    state.selectedStationId = null;
    state.currentDraft = null;
    state.trainRunning = false;
    state.trainProgress = 0;
    state.trainPauseUntil = null;
    state.trainLastStationId = null;
    if (state.trainFrameId) {
        cancelAnimationFrame(state.trainFrameId);
        state.trainFrameId = null;
    }
    setTrainBtnState(false);
    render();
}

function getSaveSlotKey(slotValue) {
    return `${STORAGE_PREFIX}${slotValue}`;
}

function saveMap() {
    const slotValue = saveSlotSelect.value;
    const snapshot = {
        lines: state.lines,
        stations: state.stations,
        lineNames: state.lineNames,
        activeColor: state.activeColor
    };
    localStorage.setItem(getSaveSlotKey(slotValue), JSON.stringify(snapshot));
    alert(`${slotValue}번 공간에 노선도를 저장했습니다.`);
}

function loadMap() {
    const slotValue = saveSlotSelect.value;
    const raw = localStorage.getItem(getSaveSlotKey(slotValue));
    if (!raw) {
        alert(`${slotValue}번 공간에 저장된 노선도가 없습니다.`);
        return;
    }

    try {
        const snapshot = JSON.parse(raw);
        state.lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
        state.stations = Array.isArray(snapshot.stations) ? snapshot.stations : [];
        state.lineNames = snapshot.lineNames && typeof snapshot.lineNames === 'object' ? snapshot.lineNames : {};
        state.activeColor = snapshot.activeColor || colorOptions[0].hex;
        state.selectedLineId = null;
        state.selectedStationId = null;
        state.currentDraft = null;
        state.trainRunning = false;
        state.trainProgress = 0;
        state.trainPauseUntil = null;
        state.trainLastStationId = null;
        if (state.trainFrameId) {
            cancelAnimationFrame(state.trainFrameId);
            state.trainFrameId = null;
        }
        setTrainBtnState(false);
        setActiveColor(state.activeColor);
        updateLegend();
        render();
        alert(`${slotValue}번 공간의 노선도를 불러왔습니다.`);
    } catch (error) {
        console.error('Failed to load saved map', error);
        alert(`${slotValue}번 공간의 노선도를 불러오지 못했습니다.`);
    }
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    state.lines.forEach((line) => {
        drawPath(line.points, line.color, 5, false);
        if (state.selectedLineId === line.id) {
            drawPath(line.points, 'rgba(0, 0, 0, 0.45)', 11, true);
        }
    });

    if (state.currentDraft) {
        drawPath(state.currentDraft.points, state.currentDraft.color, 5, false);
    }

    state.stations.forEach((station) => {
        const selected = station.id === state.selectedStationId;
        ctx.beginPath();
        ctx.fillStyle = station.transfer ? '#ffffff' : station.color;
        ctx.arc(station.x, station.y, selected ? 8 : 6, 0, Math.PI * 2);
        ctx.fill();

        if (station.transfer) {
            ctx.beginPath();
            ctx.strokeStyle = station.color;
            ctx.lineWidth = 2;
            ctx.arc(station.x, station.y, selected ? 10 : 8, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.beginPath();
        ctx.fillStyle = '#111';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(station.name, station.x + 10, station.y - 10);
    });

    if (state.trainRunning) {
        drawTrainMarker();
    }
}

function finalizeDraft(event) {
    if (event && event.pointerId && canvas.hasPointerCapture && canvas.hasPointerCapture(event.pointerId)) {
        try {
            canvas.releasePointerCapture(event.pointerId);
        } catch (e) {}
    }

    if (!state.currentDraft || state.currentDraft.points.length < 2) {
        state.currentDraft = null;
        render();
        return;
    }

    const draft = state.currentDraft;
    const existingLine = state.lines.find((line) => line.color === draft.color);

    if (draft.continueLineId) {
        const target = state.lines.find((line) => line.id === draft.continueLineId);
        if (target) {
            target.points = target.points.concat(draft.points.slice(1).map((point) => ({ ...point })));
        }
    } else if (existingLine) {
        existingLine.points = existingLine.points.concat(draft.points.slice(1).map((point) => ({ ...point })));
    } else {
        state.lines.push({
            id: Date.now() + Math.random(),
            color: draft.color,
            points: draft.points.map((point) => ({ ...point }))
        });
    }

    state.currentDraft = null;
    render();
}

function stationNearPolyline(point, points, threshold = 10) {
    for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        if (distanceToSegment(point.x, point.y, a.x, a.y, b.x, b.y) <= threshold) {
            return true;
        }
    }
    return false;
}

function addStationAtPoint(x, y, lineId) {
    const line = state.lines.find((entry) => entry.id === lineId);
    if (!line) {
        return;
    }

    const closest = findNearestPointOnLine(x, y, line.points);
    const existing = state.stations.find((station) => Math.hypot(station.x - closest.x, station.y - closest.y) <= 14);
    const requestedName = (stationNameInput.value.trim() || '역');

    if (existing) {
        if (existing.name !== requestedName) {
            const transferIds = state.lines
                .filter((other) => other.id !== lineId)
                .filter((other) => stationNearPolyline(closest, other.points, 10))
                .map((other) => other.id);

            const newStation = {
                id: Date.now() + Math.random(),
                x: closest.x,
                y: closest.y,
                color: line.color,
                name: requestedName,
                lineIds: [lineId, ...transferIds],
                transfer: transferIds.length > 0,
                transferLines: transferIds
            };

            state.stations.push(newStation);
            state.selectedStationId = newStation.id;
            stationNameInput.value = newStation.name;
            render();
            return;
        }

        state.selectedStationId = existing.id;
        stationNameInput.value = existing.name;
        render();
        return;
    }

    const transferIds = state.lines
        .filter((other) => other.id !== lineId)
        .filter((other) => stationNearPolyline(closest, other.points, 10))
        .map((other) => other.id);

    const station = {
        id: Date.now() + Math.random(),
        x: closest.x,
        y: closest.y,
        color: line.color,
        name: requestedName,
        lineIds: [lineId, ...transferIds],
        transfer: transferIds.length > 0,
        transferLines: transferIds
    };

    state.stations.push(station);
    state.selectedStationId = station.id;
    stationNameInput.value = station.name;
    render();
}

function renameSelectedStation() {
    if (state.selectedStationId === null) {
        return;
    }

    const station = state.stations.find((entry) => entry.id === state.selectedStationId);
    if (!station) {
        return;
    }

    station.name = stationNameInput.value.trim() || '역';
    render();
}

function deleteSelected() {
    if (state.selectedStationId !== null) {
        state.stations = state.stations.filter((station) => station.id !== state.selectedStationId);
        state.selectedStationId = null;
        render();
        return;
    }

    if (state.selectedLineId !== null) {
        const lineId = state.selectedLineId;
        state.lines = state.lines.filter((line) => line.id !== lineId);
        state.stations = state.stations.filter((station) => !station.lineIds || !station.lineIds.includes(lineId));
        state.selectedLineId = null;
        render();
    }
}

function handlePointerDown(event) {
    if (event.cancelable) {
        event.preventDefault();
    }

    if (canvas.setPointerCapture) {
        try {
            canvas.setPointerCapture(event.pointerId);
        } catch (e) {}
    }

    const point = getPointerPosition(event);

    if (state.mode === 'freehand' || state.mode === 'straight') {
        const continuation = findContinuationStart(point.x, point.y, state.activeColor);
        state.currentDraft = {
            color: state.activeColor,
            mode: state.mode,
            continueLineId: continuation ? continuation.id : null,
            points: continuation
                ? [{ x: continuation.points[continuation.points.length - 1].x, y: continuation.points[continuation.points.length - 1].y }, point]
                : [point]
        };
        state.selectedLineId = null;
        state.selectedStationId = null;
        render();
        return;
    }

    const lineId = findLineAtPoint(point.x, point.y);
    const stationId = findStationAtPoint(point.x, point.y);

    if (state.mode === 'select') {
        if (stationId) {
            state.selectedStationId = stationId;
            state.selectedLineId = null;
            const station = state.stations.find((entry) => entry.id === stationId);
            if (station) {
                stationNameInput.value = station.name;
                stationNameInput.focus();
            }
        } else if (lineId) {
            state.selectedLineId = lineId;
            state.selectedStationId = null;
        } else {
            state.selectedLineId = null;
            state.selectedStationId = null;
        }
        render();
        return;
    }

    if (state.mode === 'station' && lineId !== null) {
        state.selectedStationId = null;
        addStationAtPoint(point.x, point.y, lineId);
    }
}

function handlePointerMove(event) {
    if (event.cancelable) {
        event.preventDefault();
    }

    if (!state.currentDraft || (state.mode !== 'freehand' && state.mode !== 'straight')) {
        return;
    }

    const point = getPointerPosition(event);
    if (state.mode === 'straight') {
        state.currentDraft.points = [state.currentDraft.points[0], point];
    } else {
        state.currentDraft.points.push(point);
    }
    render();
}

function getLineSegments() {
    const segments = [];
    state.lines.forEach((line) => {
        for (let i = 1; i < line.points.length; i += 1) {
            segments.push({
                from: line.points[i - 1],
                to: line.points[i]
            });
        }
    });
    return segments;
}

function getNearestStationToPosition(position) {
    if (!position || state.stations.length === 0) {
        return null;
    }

    let best = null;
    for (const station of state.stations) {
        const distance = Math.hypot(position.x - station.x, position.y - station.y);
        if (!best || distance < best.distance) {
            best = { station, distance };
        }
    }

    return best;
}

function getTrainPosition(progress) {
    const segments = getLineSegments();
    if (segments.length === 0) {
        return null;
    }

    const totalLength = segments.reduce((sum, segment) => {
        return sum + Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
    }, 0);

    if (totalLength === 0) {
        return null;
    }

    let target = ((progress % 1) + 1) % 1 * totalLength;
    for (const segment of segments) {
        const segmentLength = Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
        if (target <= segmentLength) {
            const t = segmentLength === 0 ? 0 : target / segmentLength;
            return {
                x: segment.from.x + (segment.to.x - segment.from.x) * t,
                y: segment.from.y + (segment.to.y - segment.from.y) * t
            };
        }
        target -= segmentLength;
    }

    return segments[segments.length - 1].to;
}

function drawTrainMarker() {
    const position = getTrainPosition(state.trainProgress);
    if (!position) {
        return;
    }

    ctx.beginPath();
    ctx.fillStyle = '#111';
    ctx.arc(position.x, position.y, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.arc(position.x, position.y, 4, 0, Math.PI * 2);
    ctx.stroke();
}

function animateTrain() {
    if (!state.trainRunning) {
        return;
    }

    const currentPosition = getTrainPosition(state.trainProgress);
    const nearestStation = currentPosition ? getNearestStationToPosition(currentPosition) : null;

    if (nearestStation && nearestStation.distance <= 16) {
        const stationId = nearestStation.station.id;

        if (state.trainLastStationId !== stationId) {
            state.trainLastStationId = stationId;
            state.trainPauseUntil = performance.now() + 500;
            render();
            state.trainFrameId = requestAnimationFrame(animateTrain);
            return;
        }

        if (state.trainPauseUntil && state.trainPauseUntil > performance.now()) {
            render();
            state.trainFrameId = requestAnimationFrame(animateTrain);
            return;
        }

        state.trainPauseUntil = null;
        state.trainLastStationId = null;
        state.trainProgress = (state.trainProgress + 0.01) % 1;
        render();
        state.trainFrameId = requestAnimationFrame(animateTrain);
        return;
    }

    state.trainPauseUntil = null;
    state.trainLastStationId = null;
    state.trainProgress = (state.trainProgress + 0.0035) % 1;
    render();
    state.trainFrameId = requestAnimationFrame(animateTrain);
}

function toggleTrainSimulation() {
    state.trainRunning = !state.trainRunning;
    state.trainPauseUntil = null;
    state.trainLastStationId = null;
    setTrainBtnState(state.trainRunning);

    if (state.trainRunning) {
        animateTrain();
    } else if (state.trainFrameId) {
        cancelAnimationFrame(state.trainFrameId);
        state.trainFrameId = null;
        render();
    }
}

colorOptions.forEach((color) => {
    state.lineNames[color.hex] = color.defaultLine;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'color-btn';
    button.title = `${color.label} (${color.defaultLine})`;
    button.style.background = color.hex;
    button.dataset.color = color.hex;
    button.addEventListener('click', () => {
        setActiveColor(color.hex);
    });
    colorPalette.appendChild(button);
});

lineNameInput.addEventListener('input', () => {
    const value = lineNameInput.value.trim() || (colorOptions.find((entry) => entry.hex === state.activeColor)?.defaultLine || '호선');
    state.lineNames[state.activeColor] = value;
    updateLegend();
});

stationNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && state.mode === 'select' && state.selectedStationId !== null) {
        renameSelectedStation();
    }
});

stationNameInput.addEventListener('blur', () => {
    if (state.mode === 'select' && state.selectedStationId !== null) {
        renameSelectedStation();
    }
});

canvas.addEventListener('pointerdown', handlePointerDown);
canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerup', finalizeDraft);
canvas.addEventListener('pointerleave', finalizeDraft);
canvas.addEventListener('pointercancel', finalizeDraft);

// 모바일 제스처 및 스크롤 완전 방지
['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach((evtName) => {
    canvas.addEventListener(evtName, (e) => {
        e.preventDefault();
    }, { passive: false });
});

document.querySelectorAll('.mode-btn').forEach((button) => {
    button.addEventListener('click', () => {
        setMode(button.dataset.mode);
    });
});

deleteBtn.addEventListener('click', deleteSelected);
trainBtn.addEventListener('click', toggleTrainSimulation);
newMapBtn.addEventListener('click', () => {
    if (window.confirm('현재 노선도를 새로 시작할까요?')) {
        createBlankMap();
    }
});
saveMapBtn.addEventListener('click', saveMap);
loadMapBtn.addEventListener('click', loadMap);

if (legendToggleBtn) {
    legendToggleBtn.addEventListener('click', () => {
        const isOpen = lineLegend.classList.toggle('open');
        legendToggleBtn.classList.toggle('active', isOpen);
    });
}

saveSlotSelect.addEventListener('change', () => {
    const slotValue = saveSlotSelect.value;
    const stored = localStorage.getItem(getSaveSlotKey(slotValue));
    if (stored) {
        saveMapBtn.title = `${slotValue}번 공간에 저장됨`;
        loadMapBtn.title = `${slotValue}번 공간에서 불러오기`;
    } else {
        saveMapBtn.title = `${slotValue}번 공간에 저장`;
        loadMapBtn.title = `${slotValue}번 공간에서 불러오기`;
    }
});

document.addEventListener('keydown', (event) => {
    const activeTag = document.activeElement && document.activeElement.tagName;
    const isTypingField = activeTag === 'INPUT' || activeTag === 'TEXTAREA';

    if ((event.key === 'Delete' || event.key === 'Backspace') && !isTypingField) {
        deleteSelected();
    }
    if (event.key === 'Enter' && state.selectedStationId !== null && !isTypingField) {
        renameSelectedStation();
    }
});

function checkMobileDevice() {
    let isMobile = false;
    try {
        if (typeof UAParser !== 'undefined') {
            const parser = new UAParser();
            const result = parser.getResult();
            const deviceType = result.device && result.device.type;
            const osName = (result.os && result.os.name) || '';
            if (deviceType === 'mobile' || deviceType === 'tablet' || /Android|iOS|Windows Phone|BlackBerry/i.test(osName)) {
                isMobile = true;
            }
        }
    } catch (e) {
        console.warn('UAParser detection error, using fallback', e);
    }

    if (!isMobile) {
        const ua = navigator.userAgent || '';
        const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
        const isIPadOS = navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua);
        if (isMobileUA || isIPadOS) {
            isMobile = true;
        }
    }

    const isMobileViewport = window.innerWidth <= 768 || (window.innerHeight <= 520 && window.innerWidth <= 1024);

    if (isMobile || isMobileViewport) {
        document.body.classList.add('is-mobile');
    } else {
        document.body.classList.remove('is-mobile');
    }

    return isMobile;
}

function handleViewportChange() {
    checkMobileDevice();
    resizeCanvas();
}

window.addEventListener('resize', handleViewportChange);
window.addEventListener('orientationchange', () => {
    setTimeout(handleViewportChange, 150);
});

window.__metroState = state;
checkMobileDevice();
setActiveColor(state.activeColor);
updateLegend();
resizeCanvas();
