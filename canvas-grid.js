/**
 * CanvasGrid — Columnar Canvas Spreadsheet Engine
 * 
 * Architecture:
 *   Columnar data model: {colName: [val0, val1, ...]}
 *   Virtual rendering: only visible viewport cells
 *   Canvas 2D: single element, 60fps scrolling
 * 
 * Usage:
 *   const grid = new CanvasGrid(container, { columns: [...], data: {...} });
 *   grid.render();
 */

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 32;
const ROW_NUM_WIDTH = 56;
const DEFAULT_COL_WIDTH = 120;
const MIN_COL_WIDTH = 60;
const OVERSCAN = 3; // rows beyond viewport to pre-render
const FONT = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const HEADER_FONT = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

class CanvasGrid {
  constructor(container, config = {}) {
    this.container = container;
    this.config = config;

    // Column metadata
    this.columns = config.columns || [];   // [{name, type, width}]
    this.visibleCols = this.columns.filter(c => c.name !== '_id');
    this._colWidths = {};  // computed widths

    // Columnar data
    this._data = {};        // {colName: [val0, val1, ...]}
    this._idData = [];      // [_id0, _id1, ...]
    this._rowCount = 0;
    this._totalRows = 0;    // known total, 0 = unknown

    // Selection
    this._selStart = null;  // {row, col}
    this._selEnd = null;    // {row, col} — null = single cell
    this._editingCell = null; // {row, col}

    // Scroll
    this._scrollTop = 0;
    this._scrollLeft = 0;

    // Sort state
    this._sortCol = null;   // column name
    this._sortDir = null;   // 'ASC', 'DESC', null

    // Undo/redo
    this._undoStack = [];   // [{row, col, colName, oldVal, newVal, idVal, table}]
    this._redoStack = [];

    // Canvas
    this._canvas = null;
    this._ctx = null;
    this._dpr = window.devicePixelRatio || 1;

    // Themes
    this._theme = 'dark';
    this._themes = {
      dark: {
        bg:             '#0f0f0f',
        headerBg:       '#1e1e1e',
        headerText:     '#bbb',
        headerSort:     '#f0c040',
        cellBg:         '#0f0f0f',
        cellBgAlt:      '#181818',
        cellText:       '#f0f0f0',
        cellNum:        '#7ec87e',
        cellDate:       '#87ceeb',
        gridLine:       '#333',
        selectionBg:    '#1e3a5f',
        selectionBorder:'#4a90d9',
        rowNumBg:       '#1a1a1a',
        rowNumText:     '#999',
        appBg:          '#0f0f0f',
        toolbarBg:      '#1a1a1a',
        toolbarText:    '#e0e0e0',
        sidebarBg:      '#141414',
        sidebarBorder:  '#333',
        sidebarTabBg:   '#1a1a1a',
        sidebarTabText: '#999',
        inputBg:        '#0d0d0d',
        inputBorder:    '#333',
        inputText:      '#e0e0e0',
        buttonBg:       '#2a2a2a',
        buttonBorder:   '#444',
        buttonText:     '#ccc',
        msgUserBg:      '#1e3a5f',
        msgAsstBg:      '#1a2a1a',
      },
      light: {
        bg:             '#ffffff',
        headerBg:       '#f2f2f2',
        headerText:     '#555',
        headerSort:     '#c87500',
        cellBg:         '#ffffff',
        cellBgAlt:      '#f8f8f8',
        cellText:       '#222',
        cellNum:        '#1a6e1a',
        cellDate:       '#1a5e9e',
        gridLine:       '#ddd',
        selectionBg:    '#cce5ff',
        selectionBorder:'#4a90d9',
        rowNumBg:       '#f0f0f0',
        rowNumText:     '#999',
        appBg:          '#ffffff',
        toolbarBg:      '#f5f5f5',
        toolbarText:    '#333',
        sidebarBg:      '#fafafa',
        sidebarBorder:  '#ddd',
        sidebarTabBg:   '#f5f5f5',
        sidebarTabText: '#777',
        inputBg:        '#ffffff',
        inputBorder:    '#ccc',
        inputText:      '#333',
        buttonBg:       '#f0f0f0',
        buttonBorder:   '#ccc',
        buttonText:     '#333',
        msgUserBg:      '#d0e0ff',
        msgAsstBg:      '#d0f0d0',
      },
    };
    this._colors = this._themes.dark;

    // Event handlers
    this._handlers = {};

    this._init();
  }

  // ── Public API ──

  /** Set column definitions */
  setColumns(cols) {
    this.columns = cols;
    this.visibleCols = cols.filter(c => c.name !== '_id');
    this._computeColWidths();
  }

  /** Set full columnar data (replaces all) */
  setColumnarData(colData, idData) {
    this._data = colData || {};
    this._idData = idData || [];
    this._rowCount = idData ? idData.length : (Object.values(colData)[0]?.length || 0);
  }

  /** Append columnar data (pagination) */
  appendColumnarData(colData, idData) {
    for (const [col, vals] of Object.entries(colData)) {
      if (!this._data[col]) this._data[col] = [];
      this._data[col].push(...vals);
    }
    if (idData) this._idData.push(...idData);
    this._rowCount = this._idData.length || (Object.values(this._data)[0]?.length || 0);
  }

  /** Get row count */
  get rowCount() { return this._rowCount; }

  /** Set total rows (0 = unknown) */
  setTotalRows(n) { this._totalRows = n; }
  get totalRows() { return this._totalRows; }

  /** Get cell value */
  getCell(row, colIndex) {
    const colName = this.visibleCols[colIndex]?.name;
    if (!colName) return null;
    return this._data[colName]?.[row] ?? null;
  }

  /** Get _id for row */
  getId(row) {
    return this._idData[row];
  }

  /** Get current selection: {startRow, startCol, endRow, endCol} or null */
  getSelection() {
    if (!this._selStart) return null;
    return {
      startRow: this._selStart.row,
      startCol: this._selStart.col,
      endRow: this._selEnd ? this._selEnd.row : this._selStart.row,
      endCol: this._selEnd ? this._selEnd.col : this._selStart.col,
    };
  }

  /** Get selected row IDs */
  getSelectedIds() {
    const sel = this.getSelection();
    if (!sel) return new Set();
    const ids = new Set();
    for (let r = sel.startRow; r <= sel.endRow; r++) {
      ids.add(this._idData[r]);
    }
    return ids;
  }

  /** Push undo entry before cell change */
  pushUndo(row, col, colName, oldVal, newVal, idVal, tableName) {
    this._undoStack.push({ row, col, colName, oldVal, newVal, idVal, table: tableName });
    if (this._undoStack.length > 200) this._undoStack.shift();
    this._redoStack = [];
  }

  /** Can undo? */
  canUndo() { return this._undoStack.length > 0; }

  /** Can redo? */
  canRedo() { return this._redoStack.length > 0; }

  /** Pop undo entry */
  popUndo() {
    const entry = this._undoStack.pop();
    if (entry) this._redoStack.push(entry);
    return entry;
  }

  /** Pop redo entry */
  popRedo() {
    const entry = this._redoStack.pop();
    if (entry) this._undoStack.push(entry);
    return entry;
  }

  /** Sort state */
  getSortState() { return { col: this._sortCol, dir: this._sortDir }; }

  /** Toggle sort direction for a column. Returns {col, dir} or null to clear. */
  toggleSort(colName) {
    if (this._sortCol === colName) {
      if (this._sortDir === 'ASC') { this._sortDir = 'DESC'; }
      else { this._sortCol = null; this._sortDir = null; }
    } else {
      this._sortCol = colName;
      this._sortDir = 'ASC';
    }
    return this._sortCol ? { col: this._sortCol, dir: this._sortDir } : null;
  }

  /** Detect column type from sample values */
  detectColType(colName) {
    const vals = this._data[colName];
    if (!vals || vals.length === 0) return 'text';
    let numCount = 0, dateCount = 0;
    const sample = Math.min(50, vals.length);
    for (let i = 0; i < sample; i++) {
      const v = vals[i];
      if (v === null || v === undefined) continue;
      if (typeof v === 'number' || (typeof v === 'bigint')) { numCount++; continue; }
      const s = String(v).trim();
      if (s === '' || s === 'NULL' || s === 'null') continue;
      if (!isNaN(Number(s)) && s !== '') { numCount++; continue; }
      if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s)) { dateCount++; continue; }
    }
    if (numCount > sample * 0.6) return 'number';
    if (dateCount > sample * 0.5) return 'date';
    return 'text';
  }

  /** Set theme: 'dark', 'light', or 'auto' (follow system) */
  setTheme(mode) {
    if (mode === 'auto') {
      mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    this._theme = mode;
    this._colors = this._themes[mode] || this._themes.dark;
    this._draw();
    return mode;
  }

  /** Get current theme colors (for external CSS updates) */
  getColors() { return this._colors; }

  get theme() { return this._theme; }

  /** Render everything */
  render() {
    this._computeColWidths();
    this._draw();
  }

  /** Scroll to a specific row */
  scrollToRow(row) {
    const maxScroll = Math.max(0, this._rowCount * ROW_HEIGHT - this._canvas.height + HEADER_HEIGHT);
    this._scrollTop = Math.min(row * ROW_HEIGHT, maxScroll);
    this._draw();
  }

  /** Start editing cell at (row, colIndex) */
  startEdit(row, colIndex) {
    this._editingCell = { row, col: colIndex };
    this._showEditOverlay(row, colIndex);
  }

  /** Events: on('cellchange', fn), on('selectionchange', fn) */
  on(event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
    return this;
  }

  _emit(event, ...args) {
    (this._handlers[event] || []).forEach(fn => fn(...args));
  }

  // ── Initialization ──

  _init() {
    this.container.innerHTML = '';

    this._canvas = document.createElement('canvas');
    this._canvas.style.cssText = 'width:100%;height:100%;display:block;';
    this.container.appendChild(this._canvas);

    this._ctx = this._canvas.getContext('2d');

    // Overlay input for editing
    this._editInput = document.createElement('input');
    this._editInput.style.cssText = 'position:absolute;display:none;font:13px monospace;padding:2px 6px;border:2px solid #4a90d9;outline:none;background:#fff;color:#000;z-index:10;';
    this._editInput.addEventListener('blur', () => this._commitEdit());
    this._editInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._commitEdit(); }
      if (e.key === 'Escape') { this._cancelEdit(); }
      if (e.key === 'Tab') {
        e.preventDefault();
        this._commitEdit();
        this._moveEdit(0, 1);
      }
    });
    this.container.appendChild(this._editInput);

    this._bindEvents();
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const rect = this.container.getBoundingClientRect();
    const w = rect.width * this._dpr;
    const h = rect.height * this._dpr;
    if (this._canvas.width !== w || this._canvas.height !== h) {
      this._canvas.width = w;
      this._canvas.height = h;
      this._draw();
    }
  }

  // ── Column Widths ──

  _computeColWidths() {
    const ctx = this._ctx;
    ctx.font = FONT;

    for (const col of this.visibleCols) {
      if (col.width) {
        this._colWidths[col.name] = col.width;
        continue;
      }
      // Auto-width: measure column name + sample data
      let maxW = ctx.measureText(col.name).width + 16;
      const vals = this._data[col.name];
      const sampleSize = Math.min(100, vals?.length || 0);
      for (let i = 0; i < sampleSize; i++) {
        const text = String(vals[i] ?? '');
        maxW = Math.max(maxW, ctx.measureText(text).width + 16);
      }
      this._colWidths[col.name] = Math.max(MIN_COL_WIDTH, Math.min(maxW, 300));
    }
  }

  // ── Drawing ──

  _draw() {
    this._resize();  // ensure canvas matches container size

    const ctx = this._ctx;
    const canvas = this._canvas;
    const dpr = this._dpr;
    const w = canvas.width;
    const h = canvas.height;
    const C = this._colors;

    if (w === 0 || h === 0) {
      console.warn('[Grid] Canvas not sized yet (w=%d, h=%d), retrying in 100ms', w, h);
      setTimeout(() => this._draw(), 100);
      return;
    }

    // Clear
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);

    // Compute visible range
    const firstVisRow = Math.max(0, Math.floor(this._scrollTop / ROW_HEIGHT) - OVERSCAN);
    const lastVisRow = Math.min(
      this._rowCount,
      Math.ceil((this._scrollTop + h / dpr) / ROW_HEIGHT) + OVERSCAN
    );

    // Compute column X positions
    const colX = [ROW_NUM_WIDTH];
    let x = ROW_NUM_WIDTH;
    for (const col of this.visibleCols) {
      x += this._colWidths[col.name] || DEFAULT_COL_WIDTH;
      colX.push(x);
    }
    const totalWidth = colX[colX.length - 1];

    // Adjust for horizontal scroll
    const scrollLeft = this._scrollLeft;
    const offsetX = ROW_NUM_WIDTH - scrollLeft;
    const lastVisCol = (() => {
      for (let i = this.visibleCols.length - 1; i >= 0; i--) {
        if (colX[i] - scrollLeft + (this._colWidths[this.visibleCols[i].name] || 0) > 0) return i;
      }
      return -1;
    })();
    const firstVisCol = (() => {
      for (let i = 0; i < this.visibleCols.length; i++) {
        if (colX[i + 1] - scrollLeft > 0) return i;
      }
      return this.visibleCols.length;
    })();

    // ── Header Row ──
    ctx.fillStyle = C.headerBg;
    ctx.fillRect(0, 0, w, HEADER_HEIGHT * dpr);

    // Corner cell
    ctx.fillStyle = C.headerBg;
    ctx.fillRect(0, 0, ROW_NUM_WIDTH * dpr, HEADER_HEIGHT * dpr);

    // Column headers
    ctx.font = HEADER_FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (let ci = Math.max(0, firstVisCol); ci <= Math.min(lastVisCol, this.visibleCols.length - 1); ci++) {
      const col = this.visibleCols[ci];
      const cx = colX[ci] - scrollLeft;
      const cw = this._colWidths[col.name] || DEFAULT_COL_WIDTH;
      if (cx + cw < 0 || cx > w / dpr) continue;

      // Header background (highlight if sorted)
      if (col.name === this._sortCol) {
        ctx.fillStyle = '#1e3a2f';
        ctx.fillRect(cx * dpr, 0, cw * dpr, HEADER_HEIGHT * dpr);
      }

      // Column name + sort indicator
      let label = col.name;
      if (col.name === this._sortCol) {
        label += this._sortDir === 'ASC' ? ' ▲' : ' ▼';
        ctx.fillStyle = C.headerSort;
      } else {
        ctx.fillStyle = C.headerText;
      }
      ctx.fillText(label, (cx + 6) * dpr, HEADER_HEIGHT / 2 * dpr);

      // Column type indicator (subtle)
      const colType = this.detectColType(col.name);
      if (colType === 'number') {
        ctx.fillStyle = '#444';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText('#', (cx + cw - 4) * dpr, (HEADER_HEIGHT / 2 + 6) * dpr);
        ctx.font = HEADER_FONT;
        ctx.textAlign = 'left';
      }
    }

    // Header bottom line
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, HEADER_HEIGHT * dpr);
    ctx.lineTo(w, HEADER_HEIGHT * dpr);
    ctx.stroke();

    // ── Row Numbers ──
    ctx.font = FONT;
    ctx.fillStyle = C.rowNumText;
    ctx.textAlign = 'center';
    for (let r = firstVisRow; r < lastVisRow; r++) {
      const ry = HEADER_HEIGHT + (r - firstVisRow) * ROW_HEIGHT;
      const y = (ry + ROW_HEIGHT / 2) * dpr;

      // Row number background
      ctx.fillStyle = C.rowNumBg;
      ctx.fillRect(0, ry * dpr, ROW_NUM_WIDTH * dpr, ROW_HEIGHT * dpr);

      ctx.fillStyle = C.rowNumText;
      ctx.fillText(String(r + 1), ROW_NUM_WIDTH / 2 * dpr, y);

      // Grid line
      ctx.strokeStyle = C.gridLine;
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, ry * dpr);
      ctx.lineTo(w, ry * dpr);
      ctx.stroke();
    }

    // ── Data Cells ──
    ctx.font = FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (let r = firstVisRow; r < lastVisRow; r++) {
      const ry = HEADER_HEIGHT + (r - firstVisRow) * ROW_HEIGHT;

      // Alternating row background
      const rowBg = r % 2 === 0 ? C.cellBg : C.cellBgAlt;

      for (let ci = Math.max(0, firstVisCol); ci <= Math.min(lastVisCol, this.visibleCols.length - 1); ci++) {
        const col = this.visibleCols[ci];
        const cx = colX[ci] - scrollLeft;
        const cw = this._colWidths[col.name] || DEFAULT_COL_WIDTH;
        if (cx + cw < 0 || cx > w / dpr) continue;

        // Cell background
        const isSelected = this._isCellSelected(r, ci);
        ctx.fillStyle = isSelected ? C.selectionBg : rowBg;
        ctx.fillRect(cx * dpr, ry * dpr, cw * dpr, ROW_HEIGHT * dpr);

        // Cell text
        const val = this._data[col.name]?.[r];
        const text = val === null || val === undefined ? '' : String(val);
        const colType = this.detectColType(col.name);
        if (text) {
          // Pick text color based on type
          if (colType === 'number') {
            ctx.fillStyle = isSelected ? '#ffffff' : C.cellNum;
          } else if (colType === 'date') {
            ctx.fillStyle = isSelected ? '#ffffff' : C.cellDate;
          } else {
            ctx.fillStyle = isSelected ? '#ffffff' : C.cellText;
          }

          // Format value
          let displayText = text;
          if (colType === 'number' && !isNaN(Number(text)) && text !== '') {
            const n = Number(text);
            if (Number.isInteger(n)) {
              displayText = n.toLocaleString();
            } else {
              displayText = n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
            }
          } else if (colType === 'date') {
            // Try to format date nicely
            const d = new Date(text);
            if (!isNaN(d.getTime())) {
              displayText = d.toISOString().slice(0, 10);
            }
          }

          // Right-align numbers, left-align text
          ctx.save();
          ctx.beginPath();
          ctx.rect(cx * dpr, ry * dpr, cw * dpr, ROW_HEIGHT * dpr);
          ctx.clip();
          if (colType === 'number') {
            ctx.textAlign = 'right';
            ctx.fillText(displayText, (cx + cw - 6) * dpr, (ry + ROW_HEIGHT / 2) * dpr);
            ctx.textAlign = 'left';
          } else {
            ctx.textAlign = 'left';
            ctx.fillText(displayText, (cx + 6) * dpr, (ry + ROW_HEIGHT / 2) * dpr);
          }
          ctx.restore();
        }

        // Grid line
        ctx.strokeStyle = C.gridLine;
        ctx.lineWidth = isSelected ? 0 : 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(cx * dpr, ry * dpr);
        ctx.lineTo((cx + cw) * dpr, ry * dpr);
        ctx.moveTo(cx * dpr, (ry + ROW_HEIGHT) * dpr);
        ctx.lineTo((cx + cw) * dpr, (ry + ROW_HEIGHT) * dpr);
        ctx.stroke();
      }

      // Vertical grid lines (column separators)
      if (lastVisCol >= 0) {
        const c0 = Math.max(0, firstVisCol);
        ctx.strokeStyle = C.gridLine;
        ctx.lineWidth = 1 * dpr;
        for (let ci = c0; ci <= Math.min(lastVisCol + 1, this.visibleCols.length); ci++) {
          const vx = (colX[ci] - scrollLeft) * dpr;
          ctx.beginPath();
          ctx.moveTo(vx, ry * dpr);
          ctx.lineTo(vx, (ry + ROW_HEIGHT) * dpr);
          ctx.stroke();
        }
      }
    }

    // Selection border
    if (this._selStart && this._selEnd && !this._editingCell) {
      const sel = this._getSelectionBounds();
      if (sel) {
        ctx.strokeStyle = C.selectionBorder;
        ctx.lineWidth = 2 * dpr;
        const sx = (colX[sel.startCol] - scrollLeft) * dpr;
        const sy = (HEADER_HEIGHT + (sel.startRow - firstVisRow) * ROW_HEIGHT) * dpr;
        const sw = (colX[sel.endCol + 1] - colX[sel.startCol]) * dpr;
        const sh = (sel.endRow - sel.startRow + 1) * ROW_HEIGHT * dpr;
        ctx.strokeRect(sx, sy, sw, sh);
      }
    }

    // Row number vertical line
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(ROW_NUM_WIDTH * dpr, HEADER_HEIGHT * dpr);
    ctx.lineTo(ROW_NUM_WIDTH * dpr, h);
    ctx.stroke();
  }

  _isCellSelected(row, colIndex) {
    if (!this._selStart) return false;
    const sel = this._getSelectionBounds();
    if (!sel) return false;
    return row >= sel.startRow && row <= sel.endRow &&
           colIndex >= sel.startCol && colIndex <= sel.endCol;
  }

  _getSelectionBounds() {
    if (!this._selStart) return null;
    const sr = this._selStart.row, sc = this._selStart.col;
    const er = this._selEnd ? this._selEnd.row : sr;
    const ec = this._selEnd ? this._selEnd.col : sc;
    return {
      startRow: Math.min(sr, er), endRow: Math.max(sr, er),
      startCol: Math.min(sc, ec), endCol: Math.max(sc, ec),
    };
  }

  // ── Events ──

  _bindEvents() {
    // Scroll
    this._canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const oldScroll = this._scrollTop;
      this._scrollTop = Math.max(0, Math.min(
        this._scrollTop + e.deltaY,
        Math.max(0, this._rowCount * ROW_HEIGHT - this._canvas.height / this._dpr + HEADER_HEIGHT)
      ));

      this._scrollLeft = Math.max(0, this._scrollLeft + (e.deltaX || 0));

      if (Math.abs(this._scrollTop - oldScroll) > 0.5 || Math.abs(e.deltaX || 0) > 0.5) {
        this._draw();
      }
    }, { passive: false });

    // Click → select cell or sort
    this._canvas.addEventListener('click', (e) => {
      if (this._editingCell) return;
      const cell = this._eventToCell(e);
      if (!cell) return;
      if (cell.isHeader) {
        // Sort column
        const colName = this.visibleCols[cell.col]?.name;
        if (colName) {
          this.toggleSort(colName);
          this._emit('sort', this._sortCol ? { col: this._sortCol, dir: this._sortDir } : null);
          this._draw();
        }
        return;
      }
      this._selStart = { row: cell.row, col: cell.col };
      this._selEnd = null;
      this._emit('selectionchange', this.getSelection());
      this._draw();
    });

    // Double click → start edit
    this._canvas.addEventListener('dblclick', (e) => {
      const cell = this._eventToCell(e);
      if (!cell) return;
      this._selStart = { row: cell.row, col: cell.col };
      this._selEnd = null;
      this.startEdit(cell.row, cell.col);
    });

    // Mouse drag → range selection
    let dragging = false;
    this._canvas.addEventListener('mousedown', (e) => {
      dragging = true;
    });
    this._canvas.addEventListener('mousemove', (e) => {
      if (!dragging || this._editingCell) return;
      const cell = this._eventToCell(e);
      if (!cell || !this._selStart) return;
      if (cell.row !== this._selStart.row || cell.col !== this._selStart.col) {
        this._selEnd = { row: cell.row, col: cell.col };
        this._emit('selectionchange', this.getSelection());
        this._draw();
      }
    });
    this._canvas.addEventListener('mouseup', () => { dragging = false; });

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (this._editingCell) return;
      if (!this._selStart) return;

      const sr = this._selStart.row, sc = this._selStart.col;

      const moves = {
        ArrowUp:    [-1, 0],  ArrowDown:  [1, 0],
        ArrowLeft:  [0, -1],  ArrowRight: [0, 1],
        Tab:        [0, 1],
        Home:       [-sr, -sc],
        End:        [this._rowCount - 1 - sr, this.visibleCols.length - 1 - sc],
      };

      if (moves[e.key]) {
        e.preventDefault();
        const [dr, dc] = moves[e.key];
        this._selStart = {
          row: Math.max(0, Math.min(this._rowCount - 1, sr + dr)),
          col: Math.max(0, Math.min(this.visibleCols.length - 1, sc + dc)),
        };
        this._selEnd = e.shiftKey ? this._selEnd || { row: sr, col: sc } : null;
        this._scrollToCell(this._selStart);
        this._emit('selectionchange', this.getSelection());
        this._draw();
      }

      // Enter → start edit
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.startEdit(this._selStart.row, this._selStart.col);
      }

      // Escape → clear selection
      if (e.key === 'Escape') {
        this._selStart = null;
        this._selEnd = null;
        this._emit('selectionchange', null);
        this._draw();
      }
    });
  }

  _eventToCell(e) {
    const rect = this._canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Clicked on header row → sort
    if (y < HEADER_HEIGHT) {
      const colIndex = this._xToCol(x);
      if (colIndex >= 0 && colIndex < this.visibleCols.length) {
        return { row: -1, col: colIndex, isHeader: true };
      }
      return null;
    }

    // Clicked on row numbers → select row
    if (x < ROW_NUM_WIDTH) {
      const row = this._yToRow(y);
      return row >= 0 ? { row, col: 0, selectRow: true } : null;
    }

    const row = this._yToRow(y);
    const colIndex = this._xToCol(x);
    if (row < 0 || colIndex < 0) return null;
    return { row, col: colIndex };
  }

  _yToRow(y) {
    const row = Math.floor((y - HEADER_HEIGHT + this._scrollTop) / ROW_HEIGHT);
    return row < 0 || row >= this._rowCount ? -1 : row;
  }

  _xToCol(x) {
    const adjX = x + this._scrollLeft - ROW_NUM_WIDTH;
    let acc = 0;
    for (let i = 0; i < this.visibleCols.length; i++) {
      acc += this._colWidths[this.visibleCols[i].name] || DEFAULT_COL_WIDTH;
      if (adjX < acc) return i;
    }
    return this.visibleCols.length - 1;
  }

  _scrollToCell(cell) {
    const y = HEADER_HEIGHT + cell.row * ROW_HEIGHT;
    const h = this._canvas.height / this._dpr;
    if (y < this._scrollTop + HEADER_HEIGHT) {
      this._scrollTop = Math.max(0, y - HEADER_HEIGHT);
    } else if (y + ROW_HEIGHT > this._scrollTop + h) {
      this._scrollTop = Math.max(0, y + ROW_HEIGHT - h);
    }
  }

  // ── Editing ──

  _showEditOverlay(row, colIndex) {
    const col = this.visibleCols[colIndex];
    if (!col) return;

    const colX = this._computeColX();
    const cx = colX[colIndex] - this._scrollLeft;
    const cy = HEADER_HEIGHT + row * ROW_HEIGHT - this._scrollTop;
    const cw = this._colWidths[col.name] || DEFAULT_COL_WIDTH;

    const rect = this._canvas.getBoundingClientRect();
    const input = this._editInput;
    input.style.display = 'block';
    input.style.left = (rect.left + cx) + 'px';
    input.style.top = (rect.top + cy) + 'px';
    input.style.width = cw + 'px';
    input.style.height = ROW_HEIGHT + 'px';
    input.value = String(this._data[col.name]?.[row] ?? '');
    input.focus();
    input.select();
  }

  _commitEdit() {
    if (!this._editingCell) return;
    const { row, col } = this._editingCell;
    const colName = this.visibleCols[col]?.name;
    const newVal = this._editInput.value;
    const oldVal = this._data[colName]?.[row];

    this._editInput.style.display = 'none';
    this._editingCell = null;

    if (String(newVal) !== String(oldVal ?? '')) {
      if (this._data[colName]) this._data[colName][row] = this._tryParseValue(newVal, colName);
      this._emit('cellchange', row, col, oldVal, newVal);
      this._draw();
    }
  }

  _cancelEdit() {
    this._editInput.style.display = 'none';
    this._editingCell = null;
  }

  _tryParseValue(val, colName) {
    // Try parse as number
    const num = Number(val);
    if (!isNaN(num) && val.trim() !== '') return num;
    return val;
  }

  _moveEdit(dRow, dCol) {
    if (!this._editingCell) return;
    const row = this._editingCell.row + dRow;
    const col = this._editingCell.col + dCol;
    if (row >= 0 && row < this._rowCount && col >= 0 && col < this.visibleCols.length) {
      this._editingCell = null;
      this._selStart = { row, col };
      this._selEnd = null;
      this._scrollToCell({ row, col });
      this._draw();
      setTimeout(() => this.startEdit(row, col), 20);
    }
  }

  _computeColX() {
    const x = [ROW_NUM_WIDTH];
    for (let i = 0; i < this.visibleCols.length; i++) {
      x.push(x[i] + (this._colWidths[this.visibleCols[i].name] || DEFAULT_COL_WIDTH));
    }
    return x;
  }
}

// Export
if (typeof module !== 'undefined') module.exports = { CanvasGrid };
