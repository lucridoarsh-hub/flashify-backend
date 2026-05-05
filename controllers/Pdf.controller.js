import { promises as fsPromises } from 'fs';
import fs from 'fs';
import path from 'path';
import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { User } from '../models/auth.model.js';
import { CompanyList } from '../models/company.model.js';
import PDFDocument from 'pdfkit';
import { ProjectOrder } from '../models/ProjectOrder.model.js';
import { transporter } from '../util/EmailTransporter.js';
import dotenv from 'dotenv';

dotenv.config();

// ─── Cloudinary config ──────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── Directory & assets ────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, 'Uploads');

try {
  await fsPromises.mkdir(uploadsDir, { recursive: true });
} catch (err) {
  throw new Error(`Failed to create uploads directory: ${err.message}`);
}

const logoPath = path.join(__dirname, 'assets', 'company.png');

// ─── Design tokens ──────────────────────────────────────────────────────────
const COLORS = {
  primary: '#0f172a',
  secondary: '#2563eb',
  accent: '#dc2626',
  lightBg: '#f8fafc',
  darkText: '#111827',
  border: '#d1d5db',
  tableHeader: '#e5e7eb',
  tableRow: '#f9fafb',
  shadow: '#00000018',
  commitBg: '#22c55e',
  commitText: '#000000',
  oppLines: '#363636',
  diagramBg: '#ffffff',
  majorGrid: '#e2e8f0',
  minorGrid: '#f1f5f9',
};

const FONTS = {
  title: 'Helvetica-Bold',
  subtitle: 'Helvetica-Bold',
  body: 'Helvetica',
  tableHeader: 'Helvetica-Bold',
  tableBody: 'Helvetica',
  italic: 'Helvetica-Oblique',
};

// ─── Diagram constants ──────────────────────────────────────────────────────
const FOLD_LENGTH = 14;
const OPPOSITE_LINES_LEN = 150;

// ─── Layout constants ───────────────────────────────────────────────────────
const PAGE_MARGIN = 40;
const COL_GUTTER = 12;
const COLS = 2;
const CELL_WIDTH = Math.floor((595 - PAGE_MARGIN * 2 - COL_GUTTER * (COLS - 1)) / COLS);
const PROP_TABLE_H = 62;
const IMG_H_FIRST = 230;
const IMG_H_OTHER = 190;
const SVG_PX = CELL_WIDTH * 3;
const ROW_STRIDE_FIRST = IMG_H_FIRST + PROP_TABLE_H + 10;
const ROW_STRIDE_OTHER = IMG_H_OTHER + PROP_TABLE_H + 10;
const PER_PAGE_FIRST = 2;
const PER_PAGE_OTHER = 6;

// ═════════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═════════════════════════════════════════════════════════════════════════════
const validatePoints = (points) =>
  Array.isArray(points) &&
  points.length > 0 &&
  points.every(p => p && !isNaN(parseFloat(p.x)) && !isNaN(parseFloat(p.y)));

// ═════════════════════════════════════════════════════════════════════════════
// BOUNDS & OFFSET SEGMENTS
// ═════════════════════════════════════════════════════════════════════════════
const calcOffsetSegments = (path, direction, dist = 15) => {
  if (!validatePoints(path.points)) return [];
  const segs = [];
  for (let i = 0; i < path.points.length - 1; i++) {
    const p1 = path.points[i], p2 = path.points[i + 1];
    const dx = parseFloat(p2.x) - parseFloat(p1.x);
    const dy = parseFloat(p2.y) - parseFloat(p1.y);
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) continue;
    const ux = dx / len, uy = dy / len;
    const nx = direction === 'inside' ? uy : -uy;
    const ny = direction === 'inside' ? -ux : ux;
    segs.push({
      p1: { x: parseFloat(p1.x) + nx * dist, y: parseFloat(p1.y) + ny * dist },
      p2: { x: parseFloat(p2.x) + nx * dist, y: parseFloat(p2.y) + ny * dist },
    });
  }
  return segs;
};

const calculateBounds = (
  path,
  scale,
  showBorder,
  borderOffsetDirection,
  labelPositions = {},
  commits = [],
  showOppositeLines = false,
  oppositeLinesDirection = 'far'
) => {
  if (!validatePoints(path.points))
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  path.points.forEach(p => {
    const x = parseFloat(p.x), y = parseFloat(p.y);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });

  (path.segments || []).forEach((seg, i) => {
    if (!seg.labelPosition) return;
    const lx = parseFloat(seg.labelPosition.x), ly = parseFloat(seg.labelPosition.y);
    minX = Math.min(minX, lx - 60);
    maxX = Math.max(maxX, lx + 60);
    minY = Math.min(minY, ly - 35);
    maxY = Math.max(maxY, ly + 35);
  });

  (path.angles || []).forEach(angle => {
    if (!angle.labelPosition) return;
    const av = Math.round(parseFloat(angle.angle.replace(/°/g, '')));
    if ([90, 270, 45, 315].includes(av)) return;
    const lx = parseFloat(angle.labelPosition.x), ly = parseFloat(angle.labelPosition.y);
    minX = Math.min(minX, lx - 60);
    maxX = Math.max(maxX, lx + 60);
    minY = Math.min(minY, ly - 35);
    maxY = Math.max(maxY, ly + 35);
  });

  commits.forEach(c => {
    if (!c.position) return;
    const cx = parseFloat(c.position.x), cy = parseFloat(c.position.y);
    minX = Math.min(minX, cx - 60);
    maxX = Math.max(maxX, cx + 60);
    minY = Math.min(minY, cy - 30);
    maxY = Math.max(maxY, cy + 30);
  });

  if (showOppositeLines && path.points.length > 1) {
    const angle = oppositeLinesDirection === 'far' ? 135 : 315;
    const angleRad = (angle * Math.PI) / 180;
    const dx = Math.cos(angleRad), dy = Math.sin(angleRad);
    path.points.forEach(p => {
      const x = parseFloat(p.x), y = parseFloat(p.y);
      minX = Math.min(minX, x, x + dx * OPPOSITE_LINES_LEN);
      maxX = Math.max(maxX, x, x + dx * OPPOSITE_LINES_LEN);
      minY = Math.min(minY, y, y + dy * OPPOSITE_LINES_LEN);
      maxY = Math.max(maxY, y, y + dy * OPPOSITE_LINES_LEN);
    });
  }

  if (showBorder && path.points.length > 1) {
    calcOffsetSegments(path, borderOffsetDirection).forEach(s => {
      minX = Math.min(minX, s.p1.x, s.p2.x);
      maxX = Math.max(maxX, s.p1.x, s.p2.x);
      minY = Math.min(minY, s.p1.y, s.p2.y);
      maxY = Math.max(maxY, s.p1.y, s.p2.y);
    });
  }

  const span = Math.max(maxX - minX, maxY - minY);
  const padding = Math.max(40, span * 0.1);
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
};

// ═════════════════════════════════════════════════════════════════════════════
// STAT HELPERS
// ═════════════════════════════════════════════════════════════════════════════
const calcTotalFolds = (path) => {
  let total = (path.angles || []).length;
  (path.segments || []).forEach(seg => {
    const t = typeof seg.fold === 'object' && seg.fold ? seg.fold.type || 'None' : seg.fold || 'None';
    if (t !== 'None') total += t === 'Crush' ? 2 : 1;
  });
  return total;
};

const calcGirth = (path) => {
  let total = 0;
  (path.segments || []).forEach(seg => {
    total += parseFloat((seg.length || '0').replace(/[^0-9.]/g, '')) || 0;
  });
  return Math.round(total).toString();
};

const formatQxL = (arr) => {
  if (!Array.isArray(arr)) return 'N/A';
  return arr
    .map(item => `${item.quantity} x ${parseFloat(item.length).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`)
    .join(' ');
};

const mmStr = (lengthStr) => {
  if (!lengthStr) return '';
  const n = parseFloat(lengthStr);
  return isNaN(n) ? lengthStr : `${Math.round(n)}mm`;
};

// ═════════════════════════════════════════════════════════════════════════════
// SVG GENERATOR (fully collision‑avoidant)
// ═════════════════════════════════════════════════════════════════════════════
const generateSvg = (
  path, bounds, scale, showBorder, borderOffsetDirection,
  labelPositions = {}, commits = [],
  showOppositeLines = false, oppositeLinesDirection = 'far',
  W = 800
) => {
  const H = W;

  if (!validatePoints(path.points)) {
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="${COLORS.diagramBg}"/>
      <text x="50%" y="50%" font-size="20" text-anchor="middle" fill="#666">Invalid path data</text>
    </svg>`;
  }

  const pad = W * 0.05;
  const rawW = bounds.maxX - bounds.minX;
  const rawH = bounds.maxY - bounds.minY;
  const MIN_SPAN = 50;
  const effW = Math.max(rawW, MIN_SPAN);
  const effH = Math.max(rawH, MIN_SPAN);
  const sf = Math.min((W - pad * 2) / effW, (H - pad * 2) / effH);
  const drawW = effW * sf;
  const drawH = effH * sf;
  const offsetX = (W - drawW) / 2 - bounds.minX * sf;
  const offsetY = (H - drawH) / 2 - bounds.minY * sf;

  const tc = (x, y) => ({
    x: parseFloat(x) * sf + offsetX,
    y: parseFloat(y) * sf + offsetY,
  });

  const PATH_SW = 2.5;
  const POINT_R = 4;
  const BORDER_SW = 1.8;
  const OPP_SW = 1.5;
  const FOLD_SW = 2.0;
  const LABEL_H = 28;
  const LABEL_RX = 6;
  const FONT_SZ = 13;
  const ARROW_SZ = 8;
  const SHADOW_B = 2;
  const FOLD_LABEL_PX = 50;      // initial distance from path endpoint in canvas px
  const LABEL_CLEARANCE_PX = 6;

  // ── Gather all drawn line segments (canvas coords) for collision avoidance ──
  const lineSegments = [];

  const addSegment = (x1, y1, x2, y2, sw = 1) => {
    lineSegments.push({ x1, y1, x2, y2, sw });
  };

  // path segments
  for (let i = 0; i < path.points.length - 1; i++) {
    const a = tc(path.points[i].x, path.points[i].y);
    const b = tc(path.points[i + 1].x, path.points[i + 1].y);
    addSegment(a.x, a.y, b.x, b.y, PATH_SW);
  }

  // opposite lines
  if (showOppositeLines) {
    const angle = oppositeLinesDirection === 'far' ? 135 : 315;
    const rad = (angle * Math.PI) / 180;
    const dx = Math.cos(rad), dy = Math.sin(rad);
    path.points.forEach(p => {
      const x = parseFloat(p.x), y = parseFloat(p.y);
      const s = tc(x, y);
      const e = tc(x + dx * OPPOSITE_LINES_LEN, y + dy * OPPOSITE_LINES_LEN);
      addSegment(s.x, s.y, e.x, e.y, OPP_SW);
    });
  }

  // border offset segments
  if (showBorder && path.points.length > 1) {
    const segs = calcOffsetSegments(path, borderOffsetDirection, 15);
    segs.forEach(s => {
      const a = tc(s.p1.x, s.p1.y), b = tc(s.p2.x, s.p2.y);
      addSegment(a.x, a.y, b.x, b.y, BORDER_SW);
    });
  }

  // fold lines (pre‑compute to add to lineSegments and draw)
  const foldLines = [];
  (path.segments || []).forEach((seg, i) => {
    const p1 = path.points[i], p2 = path.points[i + 1];
    if (!p1 || !p2) return;

    let fType = 'None', fLen = FOLD_LENGTH, fAngle = 0, fTail = 20, fFlip = false;
    if (typeof seg.fold === 'object' && seg.fold) {
      fType = seg.fold.type || 'None';
      fLen = parseFloat(seg.fold.length) || FOLD_LENGTH;
      fAngle = parseFloat(seg.fold.angle) || 0;
      fTail = parseFloat(seg.fold.tailLength) || 20;
      fFlip = !!seg.fold.flipped;
    } else {
      fType = seg.fold || 'None';
    }

    const isFirst = i === 0;
    const isLast = i === path.points.length - 2;
    if (fType === 'None' || (!isFirst && !isLast)) return;

    const dx = parseFloat(p2.x) - parseFloat(p1.x);
    const dy = parseFloat(p2.y) - parseFloat(p1.y);
    const sl = Math.sqrt(dx * dx + dy * dy);
    if (sl === 0) return;

    const ux = dx / sl, uy = dy / sl;
    const bx = isFirst ? parseFloat(p1.x) : parseFloat(p2.x);
    const by = isFirst ? parseFloat(p1.y) : parseFloat(p2.y);
    const baseCanvas = tc(bx, by);

    // Outward perpendicular direction in canvas space
    const end1 = tc(p1.x, p1.y), end2 = tc(p2.x, p2.y);
    const sux = end2.x - end1.x, suy = end2.y - end1.y;
    const slen = Math.sqrt(sux * sux + suy * suy) || 1;
    const suxUnit = sux / slen, suyUnit = suy / slen;
    let snx = -suyUnit, sny = suxUnit; // one perpendicular
    // make it point outward (away from the other endpoint)
    const otherCanvas = isFirst ? end2 : end1;
    const toOtherX = otherCanvas.x - baseCanvas.x;
    const toOtherY = otherCanvas.y - baseCanvas.y;
    if (snx * toOtherX + sny * toOtherY > 0) { snx = -snx; sny = -sny; }

    let fPath = '';
    if (fType === 'Crush') {
      let onx = isFirst ? -uy : uy, ony = isFirst ? ux : -ux;
      if (fFlip) { onx = -onx; ony = -ony; }
      const rad = (fAngle * Math.PI) / 180;
      const cA = Math.cos(rad), sA = Math.sin(rad);
      const rNX = onx * cA - ony * sA, rNY = onx * sA + ony * cA;
      const cW = fLen * 0.8, cH = fLen * 0.6;
      const bs = fFlip ? -1 : 1;
      const cp1x = bx + rNX * cW / 3 + bs * (-rNY * cH), cp1y = by + rNY * cW / 3 + bs * (rNX * cH);
      const cp2x = bx + rNX * 2 * cW / 3 + bs * (-rNY * cH), cp2y = by + rNY * 2 * cW / 3 + bs * (rNX * cH);
      const cEx = bx + rNX * cW, cEy = by + rNY * cW;
      const tdx = isFirst ? ux : -ux, tdy = isFirst ? uy : -uy;
      const tx = cEx + tdx * fTail, ty = cEy + tdy * fTail;
      const ss = tc(bx, by), c1 = tc(cp1x, cp1y), c2 = tc(cp2x, cp2y), ce = tc(cEx, cEy), et = tc(tx, ty);
      fPath = `M${ss.x.toFixed(1)},${ss.y.toFixed(1)} C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${ce.x.toFixed(1)},${ce.y.toFixed(1)} L${et.x.toFixed(1)},${et.y.toFixed(1)}`;
      // add approximate segments for collision detection (sample a few points along the curve)
      const curvePoints = [ss, c1, c2, ce, et];
      for (let j = 0; j < curvePoints.length - 1; j++) {
        addSegment(curvePoints[j].x, curvePoints[j].y, curvePoints[j+1].x, curvePoints[j+1].y, FOLD_SW);
      }
    } else {
      const fa = (fFlip ? 360 - fAngle : fAngle) * Math.PI / 180;
      const bdx = isFirst ? ux : -ux, bdy = isFirst ? uy : -uy;
      const fdx = bdx * Math.cos(fa) - bdy * Math.sin(fa);
      const fdy = bdx * Math.sin(fa) + bdy * Math.cos(fa);
      const sb2 = tc(bx, by), se = tc(bx + fdx * fLen, by + fdy * fLen);
      fPath = `M${sb2.x.toFixed(1)},${sb2.y.toFixed(1)} L${se.x.toFixed(1)},${se.y.toFixed(1)}`;
      addSegment(sb2.x, sb2.y, se.x, se.y, FOLD_SW);
    }

    foldLines.push({
      svg: fPath,
      baseCanvas,
      dirCanvas: { x: snx, y: sny },   // outward perpendicular direction in canvas
      type: fType,
      isFirst,
    });
  });

  // ── Helper: distance from point to segment ──────────────────────────────
  const distToSegment = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const nearX = x1 + t * dx, nearY = y1 + t * dy;
    return Math.hypot(px - nearX, py - nearY);
  };

  // ── Label adjustment (checks all lineSegments) ──────────────────────────
  const adjustLabel = (cx, cy, w, featureX, featureY) => {
    let bestX = cx, bestY = cy;
    let minDist = Infinity;
    const halfDiag = Math.hypot(w / 2, LABEL_H / 2);

    const getMinDist = (x, y) => {
      let md = Infinity;
      for (const seg of lineSegments) {
        const d = distToSegment(x, y, seg.x1, seg.y1, seg.x2, seg.y2);
        if (d < md) md = d;
      }
      return md;
    };

    minDist = getMinDist(cx, cy);
    const clearance = halfDiag + PATH_SW / 2 + LABEL_CLEARANCE_PX;
    if (minDist >= clearance) return { x: cx, y: cy };

    for (let iter = 0; iter < 20; iter++) {
      let closestDist = Infinity;
      let closestSeg = null;
      for (const seg of lineSegments) {
        const d = distToSegment(cx, cy, seg.x1, seg.y1, seg.x2, seg.y2);
        if (d < closestDist) {
          closestDist = d;
          closestSeg = seg;
        }
      }
      if (!closestSeg) break;

      const { x1, y1, x2, y2 } = closestSeg;
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      let t = ((cx - x1) * dx + (cy - y1) * dy) / (len2 || 1);
      t = Math.max(0, Math.min(1, t));
      const nearX = x1 + t * dx, nearY = y1 + t * dy;

      let pushX = cx - nearX, pushY = cy - nearY;
      const pushLen = Math.hypot(pushX, pushY) || 1;
      pushX /= pushLen; pushY /= pushLen;

      const step = closestDist < 10 ? 12 : 6;
      const nx = cx + pushX * step;
      const ny = cy + pushY * step;

      const newDist = getMinDist(nx, ny);
      if (newDist >= clearance) {
        return { x: nx, y: ny };
      }
      cx = nx; cy = ny;
      if (newDist > minDist) {
        minDist = newDist;
        bestX = cx; bestY = cy;
      }
    }
    return { x: bestX, y: bestY };
  };

  // ── Tail shape helper ──────────────────────────────────────────────────
  const makeTail = (px, py, tx, ty, tw) => {
    const ldx = tx - px, ldy = ty - py;
    if (Math.abs(ldx) > Math.abs(ldy)) {
      const bx = ldx < 0 ? px - tw / 2 : px + tw / 2;
      const dir = ldx < 0 ? -ARROW_SZ : ARROW_SZ;
      return `M${bx} ${py - ARROW_SZ / 2} L${bx} ${py + ARROW_SZ / 2} L${bx + dir} ${py} Z`;
    } else {
      const by = ldy < 0 ? py - LABEL_H / 2 : py + LABEL_H / 2;
      const dir = ldy < 0 ? -ARROW_SZ : ARROW_SZ;
      return `M${px - ARROW_SZ / 2} ${by} L${px + ARROW_SZ / 2} ${by} L${px} ${by + dir} Z`;
    }
  };

  const labelPill = (px, py, text, fillColor = '#ffffff', textColor = '#111827', arrowFill = '#111827', tailPath = '') =>
    `<g filter="url(#ds)">
      <rect x="${(px - Math.max(60, text.length * 7.5 + 16) / 2).toFixed(1)}" y="${(py - LABEL_H / 2).toFixed(1)}" width="${Math.max(60, text.length * 7.5 + 16).toFixed(1)}" height="${LABEL_H}" fill="${fillColor}" rx="${LABEL_RX}" stroke="#d1d5db" stroke-width="0.8"/>
      ${tailPath ? `<path d="${tailPath}" fill="${arrowFill}"/>` : ''}
      <text x="${px.toFixed(1)}" y="${py.toFixed(1)}" font-size="${FONT_SZ}" font-family="Helvetica, Arial, sans-serif" font-weight="600" fill="${textColor}" text-anchor="middle" dominant-baseline="middle">${text}</text>
    </g>`;

  // ═════════════════════════════════════════════════════════════════════════
  // BUILD SVG OUTPUT
  // ═════════════════════════════════════════════════════════════════════════

  // Grid backgrounds
  const targetGridPx = 50;
  const rawStep = targetGridPx / sf;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceOptions = [1, 2, 5, 10];
  let gridStep = magnitude;
  for (const n of niceOptions) {
    const candidate = n * magnitude;
    if (candidate >= rawStep * 0.8) { gridStep = candidate; break; }
  }
  const gridPx = gridStep * sf;

  const defs = `<defs>
    <filter id="ds" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${SHADOW_B}"/>
      <feOffset dx="1" dy="1" result="ob"/>
      <feFlood flood-color="${COLORS.shadow}"/>
      <feComposite in2="ob" operator="in"/>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="clip">
      <rect x="0" y="0" width="${W}" height="${H}"/>
    </clipPath>
    <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <polygon points="0 0, 8 3, 0 6" fill="${COLORS.accent}"/>
    </marker>
  </defs>`;

  let bg = `<rect x="0" y="0" width="${W}" height="${H}" fill="${COLORS.diagramBg}"/>`;
  const halfGridPx = gridPx / 2;
  for (let gx = (offsetX % halfGridPx + halfGridPx) % halfGridPx; gx < W; gx += halfGridPx) {
    bg += `<line x1="${gx.toFixed(1)}" y1="0" x2="${gx.toFixed(1)}" y2="${H}" stroke="${COLORS.minorGrid}" stroke-width="0.6"/>`;
  }
  for (let gy = (offsetY % halfGridPx + halfGridPx) % halfGridPx; gy < H; gy += halfGridPx) {
    bg += `<line x1="0" y1="${gy.toFixed(1)}" x2="${W}" y2="${gy.toFixed(1)}" stroke="${COLORS.minorGrid}" stroke-width="0.6"/>`;
  }
  for (let gx = (offsetX % gridPx + gridPx) % gridPx; gx < W; gx += gridPx) {
    bg += `<line x1="${gx.toFixed(1)}" y1="0" x2="${gx.toFixed(1)}" y2="${H}" stroke="${COLORS.majorGrid}" stroke-width="1"/>`;
  }
  for (let gy = (offsetY % gridPx + gridPx) % gridPx; gy < H; gy += gridPx) {
    bg += `<line x1="0" y1="${gy.toFixed(1)}" x2="${W}" y2="${gy.toFixed(1)}" stroke="${COLORS.majorGrid}" stroke-width="1"/>`;
  }

  let c = '';

  // ── Opposite lines ─────────────────────────────────────────────────────
  if (showOppositeLines) {
    const angle = oppositeLinesDirection === 'far' ? 135 : 315;
    const rad = (angle * Math.PI) / 180;
    const dx = Math.cos(rad), dy = Math.sin(rad);
    path.points.forEach(p => {
      const x = parseFloat(p.x), y = parseFloat(p.y);
      const s = tc(x, y);
      const e = tc(x + dx * OPPOSITE_LINES_LEN, y + dy * OPPOSITE_LINES_LEN);
      c += `<line x1="${s.x.toFixed(1)}" y1="${s.y.toFixed(1)}" x2="${e.x.toFixed(1)}" y2="${e.y.toFixed(1)}" stroke="${COLORS.oppLines}" stroke-width="${OPP_SW}" stroke-opacity="0.6"/>`;
    });
  }

  // ── Border (dashed offset) + accent arrow ──────────────────────────────
  if (showBorder && path.points.length > 1) {
    const segs = calcOffsetSegments(path, borderOffsetDirection, 15);
    segs.forEach(s => {
      const a = tc(s.p1.x, s.p1.y), b = tc(s.p2.x, s.p2.y);
      c += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#374151" stroke-width="${BORDER_SW}" stroke-dasharray="8,5"/>`;
    });

    if (segs.length > 0 && path.points[0] && path.points[1]) {
      const p1 = path.points[0], p2 = path.points[1];
      const dx = parseFloat(p2.x) - parseFloat(p1.x);
      const dy = parseFloat(p2.y) - parseFloat(p1.y);
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len !== 0) {
        const ux = dx / len, uy = dy / len;
        const mx = (parseFloat(p1.x) + parseFloat(p2.x)) / 2;
        const my = (parseFloat(p1.y) + parseFloat(p2.y)) / 2;

        const nx = borderOffsetDirection === 'inside' ? -uy :  uy;
        const ny = borderOffsetDirection === 'inside' ?  ux : -ux;

        const ARROW_TAIL_LEN = 28;
        const HEAD_SIZE = 9;
        const OFFSET = 8;

        const tipX = mx + nx * OFFSET;
        const tipY = my + ny * OFFSET;
        const tailX = mx + nx * (OFFSET + ARROW_TAIL_LEN);
        const tailY = my + ny * (OFFSET + ARROW_TAIL_LEN);

        const { x: cvTipX, y: cvTipY } = tc(tipX, tipY);
        const { x: cvTailX, y: cvTailY } = tc(tailX, tailY);

        const adx = cvTipX - cvTailX, ady = cvTipY - cvTailY;
        const alen = Math.sqrt(adx * adx + ady * ady) || 1;
        const aux = adx / alen, auy = ady / alen;
        const apx = -auy, apy = aux;

        const baseX = cvTipX - aux * HEAD_SIZE;
        const baseY = cvTipY - auy * HEAD_SIZE;
        const wing1X = baseX + apx * HEAD_SIZE * 0.6;
        const wing1Y = baseY + apy * HEAD_SIZE * 0.6;
        const wing2X = baseX - apx * HEAD_SIZE * 0.6;
        const wing2Y = baseY - apy * HEAD_SIZE * 0.6;

        c += `<line x1="${cvTailX.toFixed(1)}" y1="${cvTailY.toFixed(1)}" x2="${baseX.toFixed(1)}" y2="${baseY.toFixed(1)}" stroke="${COLORS.accent}" stroke-width="2.5" stroke-linecap="round"/>`;
        c += `<polygon points="${cvTipX.toFixed(1)},${cvTipY.toFixed(1)} ${wing1X.toFixed(1)},${wing1Y.toFixed(1)} ${wing2X.toFixed(1)},${wing2Y.toFixed(1)}" fill="${COLORS.accent}" stroke="${COLORS.accent}" stroke-width="1" stroke-linejoin="round"/>`;
      }
    }
  }

  // ── Main path ──────────────────────────────────────────────────────────
  if (path.points.length > 1) {
    const pts = path.points.map(p => { const { x, y } = tc(p.x, p.y); return `${x.toFixed(1)},${y.toFixed(1)}`; }).join(' L ');
    c += `<path d="M ${pts}" stroke="#1e293b" stroke-width="${PATH_SW}" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  // ── Points ─────────────────────────────────────────────────────────────
  path.points.forEach(p => {
    const { x, y } = tc(p.x, p.y);
    c += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${POINT_R}" fill="#1e293b" stroke="#fff" stroke-width="1.5" filter="url(#ds)"/>`;
  });

  // ── Fold lines (draw) ──────────────────────────────────────────────────
  foldLines.forEach(fl => {
    c += `<path d="${fl.svg}" stroke="#374151" stroke-width="${FOLD_SW}" fill="none" stroke-linecap="round"/>`;
  });

  // ── SEGMENT LENGTH LABELS (collision‑adjusted) ─────────────────────────
  (path.segments || []).forEach((seg, i) => {
    const p1 = path.points[i], p2 = path.points[i + 1];
    if (!p1 || !p2 || !seg.labelPosition) return;

    let { x: origPx, y: origPy } = tc(seg.labelPosition.x, seg.labelPosition.y);
    const midC = tc((parseFloat(p1.x) + parseFloat(p2.x)) / 2, (parseFloat(p1.y) + parseFloat(p2.y)) / 2);
    const text = mmStr(seg.length || '');
    const tw = Math.max(60, text.length * 7.5 + 16);

    const adjusted = adjustLabel(origPx, origPy, tw, midC.x, midC.y);
    const tail = makeTail(adjusted.x, adjusted.y, midC.x, midC.y, tw);
    c += labelPill(adjusted.x, adjusted.y, text, '#ffffff', '#111827', '#111827', tail);
  });

  // ── FOLD LABELS (outward from endpoint, collision‑adjusted) ────────────
  foldLines.forEach(fl => {
    const flt = fl.type.toUpperCase();
    const ftw = Math.max(60, flt.length * 7.5 + 16);
    let lx = fl.baseCanvas.x + fl.dirCanvas.x * FOLD_LABEL_PX;
    let ly = fl.baseCanvas.y + fl.dirCanvas.y * FOLD_LABEL_PX;
    const adjusted = adjustLabel(lx, ly, ftw, fl.baseCanvas.x, fl.baseCanvas.y);
    const ftail = makeTail(adjusted.x, adjusted.y, fl.baseCanvas.x, fl.baseCanvas.y, ftw);
    c += labelPill(adjusted.x, adjusted.y, flt, '#f0f9ff', '#1d4ed8', '#1d4ed8', ftail);
  });

  // ── ANGLE LABELS ────────────────────────────────────────────────────────
  (path.angles || []).forEach(angle => {
    if (!angle.labelPosition) return;
    const av = Math.round(parseFloat(angle.angle.replace(/°/g, '')));
    if ([90, 270, 45, 315].includes(av)) return;

    let { x: origPx, y: origPy } = tc(angle.labelPosition.x, angle.labelPosition.y);
    const vertexIdx = angle.vertexIndex;
    const vx = vertexIdx !== undefined && path.points[vertexIdx] ? path.points[vertexIdx].x : angle.labelPosition.x;
    const vy = vertexIdx !== undefined && path.points[vertexIdx] ? path.points[vertexIdx].y : angle.labelPosition.y;
    const { x: vertX, y: vertY } = tc(vx, vy);
    const text = `${av}°`;
    const tw = Math.max(60, text.length * 7.5 + 16);

    const adjusted = adjustLabel(origPx, origPy, tw, vertX, vertY);
    const tail = makeTail(adjusted.x, adjusted.y, vertX, vertY, tw);
    c += labelPill(adjusted.x, adjusted.y, text, '#fff7ed', '#c2410c', '#c2410c', tail);
  });

  // ── COMMIT LABELS ───────────────────────────────────────────────────────
  commits.forEach(commit => {
    if (!commit.position) return;
    const { x: px, y: py } = tc(commit.position.x, commit.position.y);
    const msg = commit.message || 'Commit';
    c += labelPill(px, py, msg, COLORS.commitBg, COLORS.commitText, COLORS.commitText);
  });

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${defs}
    <g clip-path="url(#clip)">${bg}</g>
    <g clip-path="url(#clip)">${c}</g>
  </svg>`;
};

// ═════════════════════════════════════════════════════════════════════════════
// PDF DRAWING HELPERS
// ═════════════════════════════════════════════════════════════════════════════
const drawHeader = (doc, pageWidth, y, headerInfo, logoBuffer) => {
  const margin = PAGE_MARGIN;
  const info = headerInfo || {
    name: 'COMMERCIAL ROOFERS PTY LTD',
    contact: 'info@commercialroofers.net.au | 0421259430',
    tagline: 'Professional Roofing Solutions',
  };
  doc.rect(0, 0, pageWidth, 82).fill('#ffffff');
  doc.font(FONTS.title).fontSize(17).fillColor(COLORS.darkText).text(info.name, margin, 16);
  doc.font(FONTS.body).fontSize(10).fillColor('#4b5563').text(info.contact, margin, 40);
  doc.font(FONTS.italic).fontSize(10).fillColor('#6b7280').text(info.tagline, margin, 56);

  try {
    const src = logoBuffer || logoPath;
    const logo = doc.openImage(src);
    const lh = 48, lw = logo.width * lh / logo.height;
    doc.image(src, pageWidth - margin - lw, 16, { width: lw, height: lh });
  } catch (_) {}

  doc.moveTo(margin, 76).lineTo(pageWidth - margin, 76)
    .strokeColor(COLORS.secondary).lineWidth(1.5).undash().stroke();
  return 92;
};

const drawSectionHeader = (doc, text, y) => {
  const margin = PAGE_MARGIN;
  const pw = doc.page.width;
  doc.rect(margin, y, pw - 2 * margin, 26).fill(COLORS.lightBg);
  doc.rect(margin, y, 4, 26).fill(COLORS.secondary);
  doc.font(FONTS.subtitle).fontSize(13).fillColor(COLORS.primary)
    .text(text, margin + 14, y + 6, { width: pw - 2 * margin - 14 });
  return y + 34;
};

const drawOrderDetailsTable = (doc, JobReference, Number, OrderContact, OrderDate, DeliveryAddress, y) => {
  const margin = PAGE_MARGIN;
  const pw = doc.page.width;
  const tw = pw - 2 * margin;
  const rh = 26;

  doc.rect(margin, y, tw, rh).fill(COLORS.tableHeader);
  doc.font(FONTS.tableHeader).fontSize(12).fillColor(COLORS.primary)
    .text('ORDER DETAILS', margin + 10, y + 7);
  y += rh;

  const rows = [
    ['JOB REFERENCE', JobReference],
    ['PO NUMBER', Number],
    ['ORDER CONTACT', OrderContact],
    ['ORDER DATE', OrderDate],
    ['DELIVERY ADDRESS', DeliveryAddress || 'PICKUP'],
  ];

  rows.forEach(([label, value], i) => {
    if (i % 2 === 0) doc.rect(margin, y, tw, rh).fill(COLORS.tableRow);
    doc.circle(margin + 14, y + 13, 2).fill(COLORS.secondary);
    doc.font(FONTS.tableHeader).fontSize(10).fillColor(COLORS.darkText).text(label, margin + 24, y + 8);
    doc.font(FONTS.tableBody).fontSize(10).fillColor(COLORS.darkText).text(value, margin + tw / 2, y + 8);
    doc.moveTo(margin, y + rh).lineTo(pw - margin, y + rh)
      .strokeColor(COLORS.border).lineWidth(0.5).stroke();
    y += rh;
  });

  return y + 20;
};

const drawInstructions = (doc, y) => {
  const margin = PAGE_MARGIN;
  const pw = doc.page.width;
  y = drawSectionHeader(doc, 'IMPORTANT NOTES', y);

  const notes = [
    'Arrow points to the (solid) coloured side',
    '90° and 45° are not labelled',
    'F = Total folds; each crush counts as 2 folds',
    'End fold labels are positioned away from the diagram',
    'Green labels are commit points (annotations)',
    'Red lines are reference (opposite) lines',
  ];

  notes.forEach((note, i) => {
    doc.font(FONTS.body).fontSize(10).fillColor(COLORS.secondary)
      .text(`${i + 1}.`, margin, y);
    doc.font(FONTS.body).fontSize(10).fillColor(COLORS.darkText)
      .text(note, margin + 18, y, { width: pw - 2 * margin - 18 });
    y += 17;
  });

  y += 6;
  doc.rect(margin, y, pw - 2 * margin, 28).fill('#fee2e2');
  doc.font(FONTS.subtitle).fontSize(11).fillColor(COLORS.accent)
    .text('*** PLEASE WRITE ALL CODES ON FLASHINGS ***', margin, y + 8,
      { width: pw - 2 * margin, align: 'center' });
  return y + 42;
};

const drawFooter = (doc, pageWidth, pageHeight, pageNumber) => {
  const margin = PAGE_MARGIN;
  doc.moveTo(margin, pageHeight - 46).lineTo(pageWidth - margin, pageHeight - 46)
    .strokeColor(COLORS.border).lineWidth(0.5).stroke();
  doc.font(FONTS.body).fontSize(9).fillColor('#9ca3af')
    .text(`Page ${pageNumber}`, 0, pageHeight - 28, { width: pageWidth, align: 'center' });
};

const drawPropertyTable = (doc, x, y, pathData, qxlGroup, pathIndex, tableWidth) => {
  const rh = 20, fhdr = 8.5, fbody = 9.5;
  const colRatios = [0.07, 0.36, 0.20, 0.11, 0.26];
  const cw = colRatios.map(r => Math.floor(r * tableWidth));
  cw[cw.length - 1] += tableWidth - cw.reduce((a, b) => a + b, 0);

  const headers = ['#', 'Colour', 'CODE', 'F', 'GIRTH'];
  const totalFolds = calcTotalFolds(pathData).toString();
  const girth = `${calcGirth(pathData)}mm`;
  const color = pathData.color || 'Shale Grey';
  const code = (pathData.code || '').replace(/\D/g, '');
  const row = [(pathIndex + 1).toString(), color, code, totalFolds, girth];
  const aligns = ['center', 'left', 'center', 'center', 'center'];

  let cy = y;

  // Header row
  doc.rect(x, cy, tableWidth, rh).fill(COLORS.tableHeader);
  doc.font(FONTS.tableHeader).fontSize(fhdr).fillColor(COLORS.darkText);
  let cx = x;
  headers.forEach((h, i) => {
    doc.text(h, cx + 2, cy + (rh - fhdr) / 2, { width: cw[i] - 4, align: 'center' });
    cx += cw[i];
  });
  cy += rh;

  // Data row
  doc.font(FONTS.tableBody).fontSize(fbody);
  let maxH = 0;
  row.forEach((v, i) => { maxH = Math.max(maxH, doc.heightOfString(v, { width: cw[i] - 4 })); });
  const drh = Math.max(rh, maxH + 4);
  doc.rect(x, cy, tableWidth, drh).fill('#ffffff');
  cx = x;
  row.forEach((v, i) => {
    doc.fillColor(i === 2 ? COLORS.accent : COLORS.darkText);
    const opt = { width: cw[i] - 4, align: aligns[i], paragraphGap: 0, lineGap: 0 };
    const th = doc.heightOfString(v, opt);
    doc.text(v, cx + 2, cy + (drh - th) / 2, opt);
    cx += cw[i];
  });
  doc.fillColor(COLORS.darkText);
  cy += drh;

  // Borders
  doc.lineWidth(0.5).strokeColor(COLORS.border);
  doc.moveTo(x, y).lineTo(x + tableWidth, y).stroke();
  doc.moveTo(x, y + rh).lineTo(x + tableWidth, y + rh).stroke();
  doc.moveTo(x, cy).lineTo(x + tableWidth, cy).stroke();
  cx = x;
  for (let i = 0; i <= cw.length; i++) {
    doc.moveTo(cx, y).lineTo(cx, cy).stroke();
    if (i < cw.length) cx += cw[i];
  }

  const qxlStr = formatQxL(qxlGroup);
  let totalM = 0;
  qxlGroup.forEach(item => { totalM += item.quantity * parseFloat(item.length) / 1000; });
  doc.font(FONTS.body).fontSize(8.5).fillColor(COLORS.darkText);
  const qText = `Q x L: ${qxlStr}`;
  const qh = doc.heightOfString(qText, { width: tableWidth - 55 });
  doc.text(qText, x, cy + 3, { width: tableWidth - 55 });
  doc.text(`T - ${totalM.toFixed(1)}m`, x + tableWidth - 55, cy + 3, { align: 'right', width: 55 });
  cy += Math.max(14, qh + 4);
  return cy;
};

const drawSummaryTable = (doc, validPaths, grouped, y) => {
  const margin = PAGE_MARGIN;
  const pw = doc.page.width;
  const ph = doc.page.height;
  y = drawSectionHeader(doc, 'ORDER SUMMARY', y);

  const headers = ['#', 'Colour', 'Code', 'F', 'GIRTH', 'Q x L'];
  const colWidths = [25, 90, 60, 30, 60, pw - 2 * margin - 265];
  const minRH = 22;
  const pad = 10;

  const drawSumHeader = (y2) => {
    doc.font(FONTS.tableHeader).fontSize(10);
    let hmax = 0;
    headers.forEach((h, i) => { hmax = Math.max(hmax, doc.heightOfString(h, { width: colWidths[i] - 10 })); });
    const hh = hmax + pad;
    doc.rect(margin, y2, pw - 2 * margin, hh).fill(COLORS.tableHeader);
    doc.font(FONTS.tableHeader).fontSize(10).fillColor(COLORS.primary);
    let xp = margin;
    headers.forEach((h, i) => {
      const th = doc.heightOfString(h, { width: colWidths[i] - 10 });
      doc.text(h, xp + 5, y2 + (hh - th) / 2, { width: colWidths[i] - 10, align: 'center' });
      xp += colWidths[i];
    });
    return y2 + hh;
  };

  y = drawSumHeader(y);
  let totF = 0, totG = 0;

  validPaths.forEach((path, idx) => {
    const qxL = formatQxL(grouped[idx] || []);
    const folds = calcTotalFolds(path);
    const rawGirth = parseFloat(calcGirth(path));
    const girth = Math.round(rawGirth);
    totF += folds;
    totG += rawGirth;
    const code = (path.code || '').replace(/\D/g, '');
    const row = [`${idx + 1}`, path.color || 'N/A', code, folds.toString(), `${girth}mm`, qxL || 'N/A'];

    doc.font(FONTS.tableBody).fontSize(9.5);
    let maxH = 0;
    row.forEach((v, i) => { maxH = Math.max(maxH, doc.heightOfString(v, { width: colWidths[i] - 10 })); });
    const rh = Math.max(minRH, maxH + pad);

    if (idx % 2 === 0) doc.rect(margin, y, pw - 2 * margin, rh).fill(COLORS.tableRow);

    let xp = margin;
    row.forEach((v, i) => {
      const aln = (i === 0 || i === 3 || i === 4) ? 'center' : 'left';
      const th = doc.heightOfString(v, { width: colWidths[i] - 10 });
      doc.fillColor(i === 2 ? COLORS.accent : COLORS.darkText);
      doc.text(v, xp + 5, y + (rh - th) / 2, { width: colWidths[i] - 10, align: aln });
      xp += colWidths[i];
    });

    doc.moveTo(margin, y + rh).lineTo(pw - margin, y + rh)
      .strokeColor(COLORS.border).lineWidth(0.5).stroke();
    y += rh;

    if (y + minRH > ph - 80) {
      doc.addPage();
      y = 20;
      y = drawSectionHeader(doc, 'ORDER SUMMARY (CONTINUED)', y);
      y = drawSumHeader(y);
    }
  });

  const totRow = ['', 'Totals', '', totF.toString(), `${Math.round(totG)}mm`, ''];
  let tmH = 0;
  totRow.forEach((v, i) => { tmH = Math.max(tmH, doc.heightOfString(v, { width: colWidths[i] - 10 })); });
  const trh = Math.max(minRH, tmH + pad);
  doc.rect(margin, y, pw - 2 * margin, trh).fill(COLORS.tableHeader);
  doc.fillColor(COLORS.primary);
  let xp = margin;
  totRow.forEach((v, i) => {
    const aln = (i === 0 || i === 3 || i === 4) ? 'center' : 'left';
    const th = doc.heightOfString(v, { width: colWidths[i] - 10 });
    doc.text(v, xp + 5, y + (trh - th) / 2, { width: colWidths[i] - 10, align: aln });
    xp += colWidths[i];
  });

  return y + trh + 25;
};

// ═════════════════════════════════════════════════════════════════════════════
// RENDER CELL (per‑path overrides)
// ═════════════════════════════════════════════════════════════════════════════
const renderCell = async (
  doc, pathIndex, colX, yPos, imgH,
  validPaths, grouped,
  scale, showBorder, borderOffsetDirection,
  labelPositions, commits,
  projShowOppositeLines, projOppositeLinesDirection
) => {
  try {
    const pd = validPaths[pathIndex];

    const pathShowBorder = pd.showBorder ?? showBorder;
    const pathBorderOffsetDir = pd.borderOffsetDirection ?? borderOffsetDirection;
    const pathShowOppLines = pd.showOppositeLines ?? projShowOppositeLines;
    const pathOppLinesDir = pd.oppositeLinesDirection ?? projOppositeLinesDirection ?? 'far';

    const bounds = calculateBounds(
      pd, scale, pathShowBorder, pathBorderOffsetDir,
      labelPositions, commits,
      pathShowOppLines, pathOppLinesDir
    );
    const svg = generateSvg(
      pd, bounds, scale, pathShowBorder, pathBorderOffsetDir,
      labelPositions, commits,
      pathShowOppLines, pathOppLinesDir,
      SVG_PX
    );
    const imgBuf = await sharp(Buffer.from(svg))
      .resize({ width: SVG_PX, height: SVG_PX, fit: 'fill' })
      .png({ quality: 100, compressionLevel: 6 })
      .toBuffer();

    const tableEndY = drawPropertyTable(doc, colX, yPos, pd, grouped[pathIndex], pathIndex, CELL_WIDTH);
    doc.image(imgBuf, colX, tableEndY, { width: CELL_WIDTH, height: imgH });

    const cellH = (tableEndY - yPos) + imgH;
    doc.rect(colX, yPos, CELL_WIDTH, cellH).lineWidth(0.7).strokeColor(COLORS.border).stroke();
    doc.moveTo(colX, tableEndY).lineTo(colX + CELL_WIDTH, tableEndY)
      .lineWidth(0.4).strokeColor(COLORS.border).stroke();
  } catch (err) {
    console.warn(`Render error path ${pathIndex}:`, err.message);
    doc.font(FONTS.body).fontSize(11).fillColor(COLORS.darkText)
      .text('Diagram unavailable', colX, yPos + 10);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// MAIN EMAIL‑SEND CONTROLLER (generatePdf)
// ═════════════════════════════════════════════════════════════════════════════
export const generatePdf = async (req, res) => {
  try {
    const {
      selectedProjectData, JobReference, Number, OrderContact,
      OrderDate, DeliveryAddress, PickupNotes, Notes, AdditionalItems, emails
    } = req.body;
    const { userId } = req.params;

    console.log("preview data", selectedProjectData);

    if (!JobReference || !Number || !OrderContact || !OrderDate)
      return res.status(400).json({ message: 'JobReference, Number, OrderContact, and OrderDate are required' });
    if (!userId || !mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ message: 'Valid userId is required' });

    const QuantitiesAndLengths = selectedProjectData?.QuantitiesAndLengths || [];
    if (!Array.isArray(QuantitiesAndLengths) || QuantitiesAndLengths.length === 0)
      return res.status(400).json({ message: 'QuantitiesAndLengths must be a non-empty array' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Company info & logo
    let logoBuffer = null, headerInfo = null;
    if (user.company) {
      try {
        const company = await CompanyList.findOne({ userId: user._id });
        if (company) {
          if (company.companyImage?.length > 0) {
            const r = await fetch(company.companyImage[0].url);
            if (r.ok) logoBuffer = Buffer.from(await r.arrayBuffer());
          }
          headerInfo = {
            name: company.companyName || 'COMMERCIAL ROOFERS PTY LTD',
            contact: `${user.email || 'info@commercialroofers.net.au'}${company.phone ? ` | ${company.phone}` : ''}`,
            tagline: 'Professional Roofing Solutions',
          };
        }
      } catch (_) {}
    }
    headerInfo ||= {
      name: 'COMMERCIAL ROOFERS PTY LTD',
      contact: 'info@commercialroofers.net.au | 0421259430',
      tagline: 'Professional Roofing Solutions',
    };

    let projectData = typeof selectedProjectData === 'string' ? JSON.parse(selectedProjectData) : selectedProjectData;
    if (!projectData?.paths?.length) return res.status(400).json({ message: 'Invalid project data' });

    // Project‑level defaults
    const projShowOppositeLines = projectData.showOppositeLines || false;
    const projOppositeLinesDirection = projectData.oppositeLinesDirection || 'far';
    const scale = parseFloat(projectData.scale) || 1;
    const showBorder = projectData.showBorder || false;
    const borderOffsetDirection = projectData.borderOffsetDirection || 'inside';
    const labelPositions = projectData.labelPositions || {};
    const commits = projectData.commits || [];

    const validPaths = projectData.paths.filter(p => validatePoints(p.points));
    if (validPaths.length === 0) return res.status(400).json({ message: 'No valid paths found in project data' });

    const itemsPerPath = Math.ceil(QuantitiesAndLengths.length / validPaths.length);
    const grouped = validPaths.map((_, i) =>
      QuantitiesAndLengths.slice(i * itemsPerPath, Math.min((i + 1) * itemsPerPath, QuantitiesAndLengths.length))
    );

    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      info: { Title: `Flashing Order - ${JobReference}`, Author: 'Commercial Roofers Pty Ltd', Creator: 'Flash.it Roofing App', CreationDate: new Date() },
      autoFirstPage: false,
    });

    const timestamp = Date.now();
    const pdfPath = path.join(uploadsDir, `project-${timestamp}.pdf`);
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    const pageWidth = 595;
    const pageHeight = 842;
    const colXs = Array.from({ length: COLS }, (_, c) => PAGE_MARGIN + c * (CELL_WIDTH + COL_GUTTER));

    // ─── PAGE 1 ─────────────────────────────────────────────────────────────
    doc.addPage();
    let y = drawHeader(doc, pageWidth, 0, headerInfo, logoBuffer);
    y = drawOrderDetailsTable(doc, JobReference, user.phoneNumber || Number, user.username || OrderContact, OrderDate, DeliveryAddress || PickupNotes || 'PICKUP', y);
    y = drawInstructions(doc, y);

    const firstPageCount = Math.min(PER_PAGE_FIRST, validPaths.length);
    const remainingCount = validPaths.length - firstPageCount;
    const remainingPages = Math.ceil(remainingCount / PER_PAGE_OTHER);
    const imagePageCount = (firstPageCount > 0 ? 1 : 0) + remainingPages;
    let part = 1;

    if (firstPageCount > 0) {
      y = drawSectionHeader(doc, `FLASHING DETAILS - PART ${part++} OF ${imagePageCount}`, y);
      for (let i = 0; i < firstPageCount; i++) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const xPos = colXs[col];
        const yPos = y + row * ROW_STRIDE_FIRST;
        await renderCell(doc, i, xPos, yPos, IMG_H_FIRST, validPaths, grouped, scale, showBorder, borderOffsetDirection, labelPositions, commits, projShowOppositeLines, projOppositeLinesDirection);
      }
    }

    // ─── Subsequent diagram pages ───────────────────────────────────────────
    for (let pageIdx = 0; pageIdx < remainingPages; pageIdx++) {
      doc.addPage();
      const headerY = drawHeader(doc, pageWidth, 0, { name: 'COMMERCIAL ROOFERS PTY LTD', contact: 'info@commercialroofers.net.au | 0421259430', tagline: 'Professional Roofing Solutions' }, null);
      let secY = drawSectionHeader(doc, `FLASHING DETAILS - PART ${part++} OF ${imagePageCount}`, headerY);
      const startIdx = firstPageCount + pageIdx * PER_PAGE_OTHER;
      const thisPageCount = Math.min(PER_PAGE_OTHER, validPaths.length - startIdx);
      for (let j = 0; j < thisPageCount; j++) {
        const pathIdx = startIdx + j;
        const col = j % COLS;
        const row = Math.floor(j / COLS);
        const xPos = colXs[col];
        const yPos = secY + row * ROW_STRIDE_OTHER;
        await renderCell(doc, pathIdx, xPos, yPos, IMG_H_OTHER, validPaths, grouped, scale, showBorder, borderOffsetDirection, labelPositions, commits, projShowOppositeLines, projOppositeLinesDirection);
      }
    }

    // ─── Summary page ───────────────────────────────────────────────────────
    doc.addPage();
    const summaryStartY = drawHeader(doc, pageWidth, 0, { name: 'COMMERCIAL ROOFERS PTY LTD', contact: 'info@commercialroofers.net.au | 0421259430', tagline: 'Professional Roofing Solutions' }, null);
    drawSummaryTable(doc, validPaths, grouped, summaryStartY);

    // ─── Footers ────────────────────────────────────────────────────────────
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      drawFooter(doc, pageWidth, pageHeight, i + 1);
    }
    doc.flushPages();
    doc.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const exists = await fsPromises.access(pdfPath).then(() => true).catch(() => false);
    if (!exists) return res.status(500).json({ message: 'PDF file not generated' });

    // ─── Send email (if recipients provided) ───
    if (emails && Array.isArray(emails) && emails.length > 0) {
      try {
        const htmlTemplate = `<!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><title>Flashing Order PDF</title></head>
        <body style="font-family: Arial, sans-serif; background: #f4f4f4; padding: 20px;">
          <div style="max-width: 600px; margin: auto; background: white; border-radius: 8px; padding: 20px; box-shadow: 0 2px 8px #0000001a;">
            <h2 style="color: #0f172a;">Flashing Order PDF</h2>
            <p>Dear Customer,</p>
            <p>Please find attached the PDF for your flashing order <strong>${JobReference}</strong>.</p>
            <p>Thank you for your business.</p>
            <hr>
            <p style="font-size: 12px; color: #666;">Commercial Roofers Pty Ltd</p>
          </div>
        </body>
        </html>`;
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: emails.join(','),
          subject: `Flashing Order PDF - ${JobReference}`,
          html: htmlTemplate,
          attachments: [{ filename: `project-${timestamp}.pdf`, path: pdfPath }],
        });
      } catch (emailError) {
        console.error('Failed to send email:', emailError);
      }
    }

    // ─── Upload to Cloudinary & save order ───
    const uploadResult = await cloudinary.uploader.upload(pdfPath, {
      folder: 'freelancers',
      resource_type: 'raw',
      access_mode: 'public',
    });

    await new ProjectOrder({
      userId,
      pdf: [{ public_id: uploadResult.public_id, url: uploadResult.secure_url }],
      JobReference,
      data: projectData,
      Number,
      emailList: emails,
      OrderContact,
      OrderDate,
      DeliveryAddress: DeliveryAddress || null,
      PickupNotes: PickupNotes || null,
      Notes: Notes || null,
      AdditionalItems: AdditionalItems || null,
      QuantitiesAndLengths,
    }).save();

    await fsPromises.unlink(pdfPath).catch(e => console.warn('Delete failed:', e.message));

    return res.status(200).json({
      message: 'PDF generated successfully',
      cloudinaryUrl: uploadResult.secure_url,
    });
  } catch (error) {
    console.error('GeneratePdf error:', error.message);
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// UPDATE ORDER PDF
// ═════════════════════════════════════════════════════════════════════════════
export const UpdateGerantePdfOrder = async (req, res) => {
  try {
    const { userId, orderId } = req.params;
    if (!userId || !orderId) return res.status(400).json({ message: "UserId and OrderId are required" });

    const findUser = await User.findById(userId);
    if (!findUser) return res.status(400).json({ message: "User not found" });

    const findOrder = await ProjectOrder.findOne({ userId, _id: orderId });
    if (!findOrder) return res.status(400).json({ message: "Order not found" });

    const { JobReference, Number, OrderContact, OrderDate, DeliveryAddress, data: newData, emails } = req.body;

    const mergedData = {
      ...findOrder.data,
      paths: [
        ...(findOrder.data?.paths || []),
        ...(newData?.paths || [])
      ],
      scale: newData?.scale || findOrder.data?.scale || 1,
      showBorder: newData?.showBorder ?? findOrder.data?.showBorder ?? false,
      borderOffsetDirection: newData?.borderOffsetDirection || findOrder.data?.borderOffsetDirection || 'inside',
      showOppositeLines: newData?.showOppositeLines ?? findOrder.data?.showOppositeLines ?? false,
      oppositeLinesDirection: newData?.oppositeLinesDirection || findOrder.data?.oppositeLinesDirection || 'far',
    };

    const updatedOrderDetails = {
      JobReference: JobReference || findOrder.JobReference,
      Number: Number || findOrder.Number,
      OrderContact: OrderContact || findOrder.OrderContact,
      OrderDate: OrderDate || findOrder.OrderDate,
      DeliveryAddress: DeliveryAddress || findOrder.DeliveryAddress,
      data: mergedData,
    };

    const validPaths = mergedData.paths.filter(p => validatePoints(p.points));
    if (validPaths.length === 0) return res.status(400).json({ message: 'No valid paths found in merged data' });

    const itemsPerPath = Math.ceil(findOrder.QuantitiesAndLengths.length / validPaths.length);
    const grouped = validPaths.map((_, i) =>
      findOrder.QuantitiesAndLengths.slice(i * itemsPerPath, Math.min((i + 1) * itemsPerPath, findOrder.QuantitiesAndLengths.length))
    );

    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      info: { Title: `Flashing Order - ${updatedOrderDetails.JobReference}`, Author: 'Commercial Roofers Pty Ltd', Creator: 'Flash.it Roofing App', CreationDate: new Date() },
      autoFirstPage: false,
    });

    const timestamp = Date.now();
    const pdfPath = path.join(uploadsDir, `project-${timestamp}.pdf`);
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    const pageWidth = 595;
    const colXs = Array.from({ length: COLS }, (_, c) => PAGE_MARGIN + c * (CELL_WIDTH + COL_GUTTER));

    doc.addPage();
    let y = drawHeader(doc, pageWidth, 0, { name: findUser.company ? 'Updated Company' : 'COMMERCIAL ROOFERS PTY LTD', contact: findUser.email || 'info@commercialroofers.net.au', tagline: 'Professional Roofing Solutions' }, null);
    y = drawOrderDetailsTable(doc, updatedOrderDetails.JobReference, updatedOrderDetails.Number, updatedOrderDetails.OrderContact, updatedOrderDetails.OrderDate, updatedOrderDetails.DeliveryAddress || findOrder.PickupNotes || 'PICKUP', y);
    y = drawInstructions(doc, y);

    const firstPageCount = Math.min(PER_PAGE_FIRST, validPaths.length);
    const remainingCount = validPaths.length - firstPageCount;
    const remainingPages = Math.ceil(remainingCount / PER_PAGE_OTHER);
    const imagePageCount = (firstPageCount > 0 ? 1 : 0) + remainingPages;
    let part = 1;

    if (firstPageCount > 0) {
      y = drawSectionHeader(doc, `FLASHING DETAILS - PART ${part++} OF ${imagePageCount}`, y);
      for (let i = 0; i < firstPageCount; i++) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const xPos = colXs[col];
        const yPos = y + row * ROW_STRIDE_FIRST;
        await renderCell(doc, i, xPos, yPos, IMG_H_FIRST, validPaths, grouped, mergedData.scale, mergedData.showBorder, mergedData.borderOffsetDirection, mergedData.labelPositions || {}, mergedData.commits || [], mergedData.showOppositeLines, mergedData.oppositeLinesDirection);
      }
    }

    for (let pageIdx = 0; pageIdx < remainingPages; pageIdx++) {
      doc.addPage();
      const headerY = drawHeader(doc, pageWidth, 0, { name: 'COMMERCIAL ROOFERS PTY LTD', contact: 'info@commercialroofers.net.au | 0421259430', tagline: 'Professional Roofing Solutions' }, null);
      let secY = drawSectionHeader(doc, `FLASHING DETAILS - PART ${part++} OF ${imagePageCount}`, headerY);
      const startIdx = firstPageCount + pageIdx * PER_PAGE_OTHER;
      const thisPageCount = Math.min(PER_PAGE_OTHER, validPaths.length - startIdx);
      for (let j = 0; j < thisPageCount; j++) {
        const pathIdx = startIdx + j;
        const col = j % COLS;
        const row = Math.floor(j / COLS);
        const xPos = colXs[col];
        const yPos = secY + row * ROW_STRIDE_OTHER;
        await renderCell(doc, pathIdx, xPos, yPos, IMG_H_OTHER, validPaths, grouped, mergedData.scale, mergedData.showBorder, mergedData.borderOffsetDirection, mergedData.labelPositions || {}, mergedData.commits || [], mergedData.showOppositeLines, mergedData.oppositeLinesDirection);
      }
    }

    // Summary
    doc.addPage();
    const summaryStartY = drawHeader(doc, pageWidth, 0, { name: 'COMMERCIAL ROOFERS PTY LTD', contact: 'info@commercialroofers.net.au | 0421259430', tagline: 'Professional Roofing Solutions' }, null);
    drawSummaryTable(doc, validPaths, grouped, summaryStartY);

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      drawFooter(doc, pageWidth, 842, i + 1);
    }
    doc.flushPages();
    doc.end();

    await new Promise((resolve, reject) => { writeStream.on('finish', resolve); writeStream.on('error', reject); });

    const uploadResult = await cloudinary.uploader.upload(pdfPath, {
      folder: 'freelancers',
      resource_type: 'raw',
      access_mode: 'public',
    });

    if (emails) {
      const emailList = Array.isArray(emails) ? emails : emails.split(',').map(e => e.trim());
      if (emailList.length > 0) {
        await transporter.sendMail({
          from: `"${findUser.name}" <${findUser.email}>`,
          to: emailList,
          subject: `Updated Flashing Order - ${updatedOrderDetails.JobReference}`,
          html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">... (your rich HTML) ...</div>`,
          attachments: [{ filename: `${updatedOrderDetails.JobReference || 'FlashingOrder'}.pdf`, path: pdfPath, contentType: 'application/pdf' }],
        });
      }
    }

    await ProjectOrder.findByIdAndUpdate(orderId, {
      pdf: [{ public_id: uploadResult.public_id, url: uploadResult.secure_url }],
      ...updatedOrderDetails,
    });

    fsPromises.unlink(pdfPath).catch(() => {});

    return res.status(200).json({
      message: 'PDF updated, email sent (if provided), and order updated successfully',
      cloudinaryUrl: uploadResult.secure_url,
    });
  } catch (error) {
    console.error('UpdateGerantePdfOrder error:', error.message);
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};
