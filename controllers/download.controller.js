import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import fs, { promises as fsPromises } from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { User } from '../models/auth.model.js';
import { UserPdf } from '../models/userpdf.model.js';
import { CompanyList } from '../models/company.model.js';
dotenv.config();

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDNARY_NAME,
  api_key: process.env.CLOUDNARY_API,
  api_secret: process.env.CLOUDNARY_SECRET,
});

// Derive __dirname for ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create uploads directory
const uploadsDir = path.join(__dirname, 'Uploads');
try {
  await fsPromises.mkdir(uploadsDir, { recursive: true });
  console.log('Uploads directory created or already exists:', uploadsDir);
} catch (err) {
  console.error('Failed to create uploads directory:', err.message);
  throw new Error(`Failed to create uploads directory: ${err.message}`);
}

// Path to company logo (fallback)
const logoPath = path.join(__dirname, 'assets', 'company.png');

// Professional color scheme
const COLORS = {
  primary: '#0f172a',
  secondary: '#2563eb',
  accent: '#dc2626',
  lightBg: '#f9fafb',
  darkText: '#111827',
  border: '#d1d5db',
  tableHeader: '#e5e7eb',
  tableRow: '#f9fafb',
  success: '#16a34a',
  warning: '#d97706',
  shadow: '#0000001a',
  commitBg: '#00FF00',
  commitText: '#000000',
  oppositeLines: '#FF0000',
};

// Font settings
const FONTS = {
  title: 'Helvetica-Bold',
  subtitle: 'Helvetica-Bold',
  body: 'Helvetica',
  tableHeader: 'Helvetica-Bold',
  tableBody: 'Helvetica',
  italic: 'Helvetica-Oblique',
  monospace: 'Courier',
};

// Configuration constants
const GRID_SIZE = 20;
const FOLD_LENGTH = 14;
const ARROW_SIZE = 12;
const CHEVRON_SIZE = 10;
const HOOK_RADIUS = 8;
const ZIGZAG_SIZE = 9;
const LABEL_PADDING = 12;
const SHADOW_OFFSET = 2;
const SCALE_BAR_LENGTH = 100;
const FOLD_LABEL_DISTANCE = 60;
const OPPOSITE_LINES_LENGTH = 150;

// Helper function to validate points
const validatePoints = (points) => {
  if (!Array.isArray(points) || points.length === 0) {
    return false;
  }
  return points.every(point =>
    point &&
    typeof point.x !== 'undefined' &&
    typeof point.y !== 'undefined' &&
    !isNaN(parseFloat(point.x)) &&
    !isNaN(parseFloat(point.y))
  );
};

// Helper function to calculate bounds for a path
const calculateBounds = (path, scale, showBorder, borderOffsetDirection, labelPositions = {}, commits = [], showOppositeLines = false, oppositeLinesDirection = 'far') => {
  if (!validatePoints(path.points)) {
    console.warn('Invalid points array in path:', path);
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  }
 
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  path.points.forEach((point) => {
    const x = parseFloat(point.x);
    const y = parseFloat(point.y);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });
  const isLargeDiagram = (maxX - minX > 10000 || maxY - minY > 10000);
 
  // Process segment labels
  path.segments.forEach((segment, i) => {
    if (!segment.labelPosition || typeof segment.labelPosition.x === 'undefined' || typeof segment.labelPosition.y === 'undefined') {
      return;
    }
    const labelX = parseFloat(segment.labelPosition.x);
    const labelY = parseFloat(segment.labelPosition.y);
    minX = Math.min(minX, labelX - 50);
    maxX = Math.max(maxX, labelX + 50);
    minY = Math.min(minY, labelY - 30);
    maxY = Math.max(maxY, labelY + ARROW_SIZE + 30);
    const foldLabelKey = `fold-${path.pathIndex}-${i}`;
    const foldLabelPos = labelPositions[foldLabelKey];
    if (foldLabelPos) {
      const foldLabelX = parseFloat(foldLabelPos.x);
      const foldLabelY = parseFloat(foldLabelPos.y);
      minX = Math.min(minX, foldLabelX - 50);
      maxX = Math.max(maxX, foldLabelX + 50);
      minY = Math.min(minY, foldLabelY - 30);
      maxY = Math.max(maxY, foldLabelY + ARROW_SIZE + 30);
    }
  });
  // Process angle labels
  (path.angles || []).forEach((angle) => {
    if (!angle.labelPosition || typeof angle.labelPosition.x === 'undefined' || typeof angle.labelPosition.y === 'undefined') {
      return;
    }
    const angleValue = parseFloat(angle.angle.replace(/°/g, ''));
    const roundedValue = Math.round(angleValue);
    if (roundedValue === 90 || roundedValue === 270 || roundedValue === 45 || roundedValue === 315) {
      return;
    }
    const labelX = parseFloat(angle.labelPosition.x);
    const labelY = parseFloat(angle.labelPosition.y);
    minX = Math.min(minX, labelX - 50);
    maxX = Math.max(maxX, labelX + 50);
    minY = Math.min(minY, labelY - 30);
    maxY = Math.max(maxY, labelY + ARROW_SIZE + 30);
  });
  // Process commit positions
  commits.forEach(commit => {
    if (commit.position) {
      const cx = parseFloat(commit.position.x);
      const cy = parseFloat(commit.position.y);
      const labelWidth = 90;
      const labelHeight = 36;
      minX = Math.min(minX, cx - labelWidth/2 - 10);
      maxX = Math.max(maxX, cx + labelWidth/2 + 10);
      minY = Math.min(minY, cy - labelHeight/2 - 10);
      maxY = Math.max(maxY, cy + labelHeight/2 + 10);
    }
  });
  // Process opposite lines if enabled
  if (showOppositeLines && path.points.length > 1) {
    let angle = oppositeLinesDirection === 'far' ? 135 : 315;
    const angleRad = angle * Math.PI / 180;
    const dx = Math.cos(angleRad);
    const dy = Math.sin(angleRad);
    path.points.forEach(point => {
      const x = parseFloat(point.x);
      const y = parseFloat(point.y);
      const projX = x + dx * OPPOSITE_LINES_LENGTH;
      const projY = y + dy * OPPOSITE_LINES_LENGTH;
      minX = Math.min(minX, x, projX);
      maxX = Math.max(maxX, x, projX);
      minY = Math.min(minY, y, projY);
      maxY = Math.max(maxY, y, projY);
    });
  }
  // Process border
  if (showBorder && path.points.length > 1) {
    const offsetSegments = calculateOffsetSegments(path, borderOffsetDirection);
    offsetSegments.forEach((seg) => {
      minX = Math.min(minX, seg.p1.x, seg.p2.x);
      maxX = Math.max(maxX, seg.p1.x, seg.p2.x);
      minY = Math.min(minY, seg.p1.y, seg.p2.y);
      maxY = Math.max(maxY, seg.p1.y, seg.p2.y);
    });
   
    const segment = offsetSegments[0];
    if (segment) {
      const origP1 = path.points[0];
      const origP2 = path.points[1];
      if (origP1 && origP2) {
        const dx = parseFloat(origP2.x) - parseFloat(origP1.x);
        const dy = parseFloat(origP2.y) - parseFloat(origP1.y);
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length !== 0) {
          const unitX = dx / length;
          const unitY = dy / length;
          const midX_main = (parseFloat(origP1.x) + parseFloat(origP2.x)) / 2;
          const midY_main = (parseFloat(origP1.y) + parseFloat(origP2.y)) / 2;
          const arrowNormalX = borderOffsetDirection === 'inside' ? -unitY : unitY;
          const arrowNormalY = borderOffsetDirection === 'inside' ? unitX : -unitX;
          const chevronBaseDistance = 10;
          const chevronSize = 8;
          const chevronX = midX_main + arrowNormalX * chevronBaseDistance;
          const chevronY = midY_main + arrowNormalY * chevronBaseDistance;
          minX = Math.min(minX, chevronX - chevronSize);
          maxX = Math.max(maxX, chevronX + chevronSize);
          minY = Math.min(minY, chevronY - chevronSize);
          maxY = Math.max(maxY, chevronY + chevronSize);
        }
      }
    }
  }
  const padding = isLargeDiagram ? Math.max(50, (maxX - minX) * 0.05) : 40;
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
};

// Helper function to calculate offset segments for border
const calculateOffsetSegments = (path, borderOffsetDirection, offsetScale = 1) => {
  if (!validatePoints(path.points)) return [];
  const baseOffsetDistance = 15;
  const offsetDistance = Math.max(4, baseOffsetDistance * offsetScale)
  const offsetSegments = [];
  for (let i = 0; i < path.points.length - 1; i++) {
    const p1 = path.points[i];
    const p2 = path.points[i + 1];
    const dx = parseFloat(p2.x) - parseFloat(p1.x);
    const dy = parseFloat(p2.y) - parseFloat(p1.y);
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) continue;
    const unitX = dx / length;
    const unitY = dy / length;
    const normalX = borderOffsetDirection === 'inside' ? unitY : -unitY;
    const normalY = borderOffsetDirection === 'inside' ? -unitX : unitX;
    offsetSegments.push({
      p1: { x: parseFloat(p1.x) + normalX * offsetDistance, y: parseFloat(p1.y) + normalY * offsetDistance },
      p2: { x: parseFloat(p2.x) + normalX * offsetDistance, y: parseFloat(p2.y) + normalY * offsetDistance },
    });
  }
  return offsetSegments;
};

// Helper function to calculate fold label position with fixed distance
const calculateFoldLabelPosition = (segment, isFirstSegment, p1, p2, foldType, foldAngle = 0, flipped = false) => {
  const dx = parseFloat(p2.x) - parseFloat(p1.x);
  const dy = parseFloat(p2.y) - parseFloat(p1.y);
  const length = Math.sqrt(dx * dx + dy * dy);
 
  if (length === 0) return null;
  const unitX = dx / length;
  const unitY = dy / length;
 
  const basePoint = isFirstSegment ? p1 : p2;
 
  let baseDirX, baseDirY;
  if (isFirstSegment) {
    baseDirX = unitX;
    baseDirY = unitY;
  } else {
    baseDirX = -unitX;
    baseDirY = -unitY;
  }
  let normalX = -baseDirY;
  let normalY = baseDirX;
 
  if (flipped) {
    normalX = -normalX;
    normalY = -normalY;
  }
  let labelDirX, labelDirY;
 
  if (foldType === 'Crush') {
    labelDirX = normalX;
    labelDirY = normalY;
  } else {
    const foldAngleRad = (foldAngle * Math.PI) / 180;
    labelDirX = baseDirX * Math.cos(foldAngleRad) - baseDirY * Math.sin(foldAngleRad);
    labelDirY = baseDirX * Math.sin(foldAngleRad) + baseDirY * Math.cos(foldAngleRad);
   
    const dotProduct = labelDirX * normalX + labelDirY * normalY;
    if (dotProduct < 0) {
      labelDirX = -labelDirX;
      labelDirY = -labelDirY;
    }
  }
  const dirLength = Math.sqrt(labelDirX * labelDirX + labelDirY * labelDirY);
  if (dirLength > 0) {
    labelDirX /= dirLength;
    labelDirY /= dirLength;
  }
  const labelX = parseFloat(basePoint.x) + labelDirX * FOLD_LABEL_DISTANCE;
  const labelY = parseFloat(basePoint.y) + labelDirY * FOLD_LABEL_DISTANCE;
  return { x: labelX, y: labelY };
};

// Helper function to calculate total folds
const calculateTotalFolds = (path) => {
  let totalFolds = (path.angles || []).length;
  if (Array.isArray(path.segments)) {
    path.segments.forEach(segment => {
      let foldType = 'None';
      if (typeof segment.fold === 'object' && segment.fold) {
        foldType = segment.fold.type || 'None';
      } else {
        foldType = segment.fold || 'None';
      }
      if (foldType !== 'None') {
        totalFolds += foldType === 'Crush' ? 2 : 1;
      }
    });
  }
  return totalFolds;
};

// Helper function to calculate girth
const calculateGirth = (path) => {
  let totalLength = 0;
  if (Array.isArray(path.segments)) {
    path.segments.forEach(segment => {
      const lengthStr = segment.length || '0 m';
      const lengthNum = parseFloat(lengthStr.replace(/[^0-9.]/g, '')) || 0;
      totalLength += lengthNum;
    });
  }
  // Round to nearest integer and return as string without decimal
  return Math.round(totalLength).toString();
};

// Helper function to format Q x L
const formatQxL = (quantitiesAndLengths) => {
  if (!Array.isArray(quantitiesAndLengths)) return 'N/A';
  return quantitiesAndLengths.map(item => `${item.quantity} x ${parseFloat(item.length).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`).join(' ');
};

// ─────────────────────────────────────────────────────────────
// FIX 1: Convert length to mm – integer only, no decimals
// ─────────────────────────────────────────────────────────────
const convertMtoMM = (lengthStr) => {
  if (!lengthStr) return '';
  const num = parseFloat(lengthStr);
  if (isNaN(num)) return lengthStr;
  // Round to nearest integer – "230mm" not "230.33mm"
  return Math.round(num) + 'mm';
};

// ─────────────────────────────────────────────────────────────
// FIX 2: Smart SVG generation that adapts to diagram size
// ─────────────────────────────────────────────────────────────
const generateSvgString = (path, bounds, scale, showBorder, borderOffsetDirection, labelPositions = {}, commits = [], showOppositeLines = false, oppositeLinesDirection = 'far') => {
  if (!validatePoints(path.points)) {
    console.warn('Skipping SVG generation for path due to invalid points:', path);
    return '<svg width="100%" height="100%" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><text x="50" y="50" font-size="14" text-anchor="middle" fill="#000000">Invalid path data</text></svg>';
  }
 
  const rawWidth = bounds.maxX - bounds.minX;
  const rawHeight = bounds.maxY - bounds.minY;
  // ── Adaptive viewBox ──────────────────────────────────────
  const targetViewBoxSize = 1200;
  const MIN_SPAN = 80;
  const effectiveSpan = Math.max(rawWidth, rawHeight, MIN_SPAN);
  const rawScaleFactor = targetViewBoxSize * 0.75 / effectiveSpan;
  const MAX_SCALE = 4;
  const scaleFactor = Math.min(rawScaleFactor, MAX_SCALE);
  const offsetX = (targetViewBoxSize - rawWidth * scaleFactor) / 2;
  const offsetY = (targetViewBoxSize - rawHeight * scaleFactor) / 2;
  const viewBox = `0 0 ${targetViewBoxSize} ${targetViewBoxSize}`;
  // ── Adaptive stroke / label metrics ──────────────────────
  const uiScale = Math.min(scaleFactor, 1.5);
  const avgSpan = (rawWidth + rawHeight) / 2;
  const referenceSpan = 500;
  const sizeBasedScale = Math.min(1.5, Math.max(0.5, avgSpan / referenceSpan));
  const offsetScale = uiScale * sizeBasedScale;
  const fontSize = Math.max(14, Math.min(22, 18 * uiScale));
  const labelH = Math.max(28, Math.min(40, 36 * uiScale));
  const labelRx = Math.max(8, Math.min(14, 12 * uiScale));
  const tailSz = Math.max(7, Math.min(12, 10 * uiScale));
  const attachSz = Math.max(7, Math.min(12, 10 * uiScale));
  const ptRadius = Math.max(2, Math.min(5, 3 * uiScale));
  const mainStroke = Math.max(1.5, Math.min(3, 2.5 * uiScale));
  const foldStroke = Math.max(1, Math.min(2.5, 2 * uiScale));
  const borderStroke = Math.max(1.5, Math.min(4, 3 * uiScale));
  const oppStroke = Math.max(2, Math.min(5, 3.5 * uiScale));
  const shadowBlur = Math.max(1, Math.min(3, 2 * uiScale));
  // ─────────────────────────────────────────────────────────
  const transformCoord = (x, y) => ({
    x: (parseFloat(x) - bounds.minX) * scaleFactor + offsetX,
    y: (parseFloat(y) - bounds.minY) * scaleFactor + offsetY,
  });
  let svgDefs = `
    <defs>
      <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="${shadowBlur}" />
        <feOffset dx="${shadowBlur}" dy="${shadowBlur}" result="offsetblur" />
        <feFlood flood-color="${COLORS.shadow}" />
        <feComposite in2="offsetblur" operator="in" />
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  `;
  // Generate grid lines
  let gridLines = '';
  const minorGridSize = GRID_SIZE / 2;
  const gridStartX = Math.floor(bounds.minX / GRID_SIZE) * GRID_SIZE;
  const gridStartY = Math.floor(bounds.minY / GRID_SIZE) * GRID_SIZE;
  const gridEndX = Math.ceil(bounds.maxX / GRID_SIZE) * GRID_SIZE;
  const gridEndY = Math.ceil(bounds.maxY / GRID_SIZE) * GRID_SIZE;
  for (let x = gridStartX; x <= gridEndX; x += minorGridSize) {
    const {x: tx1, y: ty1} = transformCoord(x, gridStartY);
    const {x: tx2, y: ty2} = transformCoord(x, gridEndY);
    gridLines += `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="#e0e0e0" stroke-width="0.3"/>`;
  }
  for (let y = gridStartY; y <= gridEndY; y += minorGridSize) {
    const {x: tx1, y: ty1} = transformCoord(gridStartX, y);
    const {x: tx2, y: ty2} = transformCoord(gridEndX, y);
    gridLines += `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="#e0e0e0" stroke-width="0.3"/>`;
  }
  for (let x = gridStartX; x <= gridEndX; x += GRID_SIZE) {
    const {x: tx1, y: ty1} = transformCoord(x, gridStartY);
    const {x: tx2, y: ty2} = transformCoord(x, gridEndY);
    gridLines += `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="#c4b7b7" stroke-width="0.5"/>`;
  }
  for (let y = gridStartY; y <= gridEndY; y += GRID_SIZE) {
    const {x: tx1, y: ty1} = transformCoord(gridStartX, y);
    const {x: tx2, y: ty2} = transformCoord(gridEndX, y);
    gridLines += `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="#c4b7b7" stroke-width="0.5"/>`;
  }
  // Path points & lines
  let svgContent = path.points.map((point) => {
    const {x: cx, y: cy} = transformCoord(point.x, point.y);
    return `<circle cx="${cx}" cy="${cy}" r="${ptRadius}" fill="#000000" filter="url(#dropShadow)"/>`;
  }).join('');
  if (path.points.length > 1) {
    const d = path.points.map(p => {
      const {x, y} = transformCoord(p.x, p.y);
      return `${x},${y}`;
    }).join(' L');
    svgContent += `<path d="M${d}" stroke="#000000" stroke-width="${mainStroke}" fill="none"/>`;
  }
  // Opposite lines
  if (showOppositeLines && path.points.length > 0) {
    const angle = oppositeLinesDirection === 'far' ? 135 : 315;
    const angleRad = angle * Math.PI / 180;
    const dx = Math.cos(angleRad);
    const dy = Math.sin(angleRad);
   
    path.points.forEach((point) => {
      const x = parseFloat(point.x);
      const y = parseFloat(point.y);
      const projX = x + dx * OPPOSITE_LINES_LENGTH;
      const projY = y + dy * OPPOSITE_LINES_LENGTH;
      const {x: x1, y: y1} = transformCoord(x, y);
      const {x: x2, y: y2} = transformCoord(projX, projY);
      svgContent += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${COLORS.oppositeLines}" stroke-width="${oppStroke}" stroke-opacity="0.5"/>`;
    });
  }
  // Border offset segments
  if (showBorder && path.points.length > 1) {
    const offsetSegments = calculateOffsetSegments(path, borderOffsetDirection, offsetScale);
    svgContent += offsetSegments.map((segment) => {
      const {x: x1, y: y1} = transformCoord(segment.p1.x, segment.p1.y);
      const {x: x2, y: y2} = transformCoord(segment.p2.x, segment.p2.y);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000000" stroke-width="${borderStroke}" stroke-dasharray="6,4"/>`;
    }).join('');
   
    const segment = offsetSegments[0];
    if (segment) {
      const origP1 = path.points[0];
      const origP2 = path.points[1];
      if (origP1 && origP2) {
        const dx = parseFloat(origP2.x) - parseFloat(origP1.x);
        const dy = parseFloat(origP2.y) - parseFloat(origP1.y);
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length !== 0) {
          const unitX = dx / length;
          const unitY = dy / length;
          const midX_main = (parseFloat(origP1.x) + parseFloat(origP2.x)) / 2;
          const midY_main = (parseFloat(origP1.y) + parseFloat(origP2.y)) / 2;
          const arrowNormalX = borderOffsetDirection === 'inside' ? -unitY : unitY;
          const arrowNormalY = borderOffsetDirection === 'inside' ? unitX : -unitX;
          const chevronSize = 8 * offsetScale;
          const chevronBaseDistance = 10 * offsetScale;
          const chevronX = midX_main + arrowNormalX * chevronBaseDistance;
          const chevronY = midY_main + arrowNormalY * chevronBaseDistance;
          const {x: chevronXView, y: chevronYView} = transformCoord(chevronX, chevronY);
          const cvSz = chevronSize * scaleFactor;
          const direction = 1;
          const chevronPath = `
            M${chevronXView + cvSz * arrowNormalX * direction + cvSz * unitX},${chevronYView + cvSz * arrowNormalY * direction + cvSz * unitY}
            L${chevronXView},${chevronYView}
            L${chevronXView + cvSz * arrowNormalX * direction - cvSz * unitX},${chevronYView + cvSz * arrowNormalY * direction - cvSz * unitY}
            Z`;
          svgContent += `<path d="${chevronPath}" stroke="${COLORS.accent}" stroke-width="2" fill="${COLORS.accent}"/>`;
        }
      }
    }
  }
  // ── Segment labels ────────────────────────────────────────
  const labelBg = '#FFFFFF';
  const labelTextColor = '#000000';
  const tailFill = '#000000';
  svgContent += (Array.isArray(path.segments) ? path.segments : []).map((segment, i) => {
    const p1 = path.points[i];
    const p2 = path.points[i + 1];
    if (!p1 || !p2 || !segment.labelPosition) return '';
   
    const {x: posX, y: posY} = transformCoord(segment.labelPosition.x, segment.labelPosition.y);
    const {x: p1x, y: p1y} = transformCoord(p1.x, p1.y);
    const {x: p2x, y: p2y} = transformCoord(p2.x, p2.y);
    const midX = (p1x + p2x) / 2;
    const midY = (p1y + p2y) / 2;
    const labelDx = midX - posX;
    const labelDy = midY - posY;
    const absLabelDx = Math.abs(labelDx);
    const absLabelDy = Math.abs(labelDy);
    const lengthDisplay = convertMtoMM(segment.length || '');
    const textContent = lengthDisplay;
   
    const approxTextWidth = textContent.length * (fontSize * 0.6);
    const labelWidth = Math.max(80, approxTextWidth + 20);
    let tailPath = '';
    if (absLabelDx > absLabelDy) {
      if (labelDx < 0) {
        const baseX = posX - labelWidth / 2;
        const tipX = baseX - tailSz;
        tailPath = `M${baseX} ${posY - attachSz/2} L${baseX} ${posY + attachSz/2} L${tipX} ${posY} Z`;
      } else {
        const baseX = posX + labelWidth / 2;
        const tipX = baseX + tailSz;
        tailPath = `M${baseX} ${posY - attachSz/2} L${baseX} ${posY + attachSz/2} L${tipX} ${posY} Z`;
      }
    } else {
      if (labelDy < 0) {
        const baseY = posY - labelH / 2;
        const tipY = baseY - tailSz;
        tailPath = `M${posX - attachSz/2} ${baseY} L${posX + attachSz/2} ${baseY} L${posX} ${tipY} Z`;
      } else {
        const baseY = posY + labelH / 2;
        const tipY = baseY + tailSz;
        tailPath = `M${posX - attachSz/2} ${baseY} L${posX + attachSz/2} ${baseY} L${posX} ${tipY} Z`;
      }
    }
    // ── Fold element ─────────────────────────────────────────
    let foldElement = '';
    let foldType = 'None';
    let foldLength = FOLD_LENGTH;
    let foldAngle = 0;
    let tailLengthVal = 20;
    let flipped = false;
   
    if (typeof segment.fold === 'object' && segment.fold) {
      foldType = segment.fold.type || 'None';
      foldLength = parseFloat(segment.fold.length) || FOLD_LENGTH;
      foldAngle = parseFloat(segment.fold.angle) || 0;
      tailLengthVal = parseFloat(segment.fold.tailLength) || 20;
      flipped = !!segment.fold.flipped;
    } else {
      foldType = segment.fold || 'None';
    }
    if (foldType !== 'None') {
      const dx = parseFloat(p2.x) - parseFloat(p1.x);
      const dy = parseFloat(p2.y) - parseFloat(p1.y);
      const segLength = Math.sqrt(dx * dx + dy * dy);
     
      if (segLength !== 0) {
        const unitX = dx / segLength;
        const unitY = dy / segLength;
        const isFirstSegment = i === 0;
        const isLastSegment = i === path.points.length - 2;
       
        if (isFirstSegment || isLastSegment) {
          let modelFoldBaseX = isFirstSegment ? parseFloat(p1.x) : parseFloat(p2.x);
          let modelFoldBaseY = isFirstSegment ? parseFloat(p1.y) : parseFloat(p2.y);
          let foldPath = '';
         
          if (foldType === 'Crush') {
            let normalX = isFirstSegment ? -unitY : unitY;
            let normalY = isFirstSegment ? unitX : -unitX;
            if (flipped) { normalX = -normalX; normalY = -normalY; }
            const angleRad = foldAngle * Math.PI / 180;
            const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);
            const rotNormalX = normalX * cosA - normalY * sinA;
            const rotNormalY = normalX * sinA + normalY * cosA;
            const curveHeight = foldLength * 0.6;
            const curveWidth = foldLength * 0.8;
            const modelStartX = modelFoldBaseX, modelStartY = modelFoldBaseY;
            const modelCurveEndX = modelStartX + rotNormalX * curveWidth;
            const modelCurveEndY = modelStartY + rotNormalY * curveWidth;
            const bulgeSign = flipped ? -1 : 1;
            const modelCp1X = modelStartX + rotNormalX * (curveWidth / 3) + bulgeSign * (-rotNormalY * curveHeight);
            const modelCp1Y = modelStartY + rotNormalY * (curveWidth / 3) + bulgeSign * ( rotNormalX * curveHeight);
            const modelCp2X = modelStartX + rotNormalX * (2 * curveWidth / 3) + bulgeSign * (-rotNormalY * curveHeight);
            const modelCp2Y = modelStartY + rotNormalY * (2 * curveWidth / 3) + bulgeSign * ( rotNormalX * curveHeight);
            const tailDirX = isFirstSegment ? unitX : -unitX;
            const tailDirY = isFirstSegment ? unitY : -unitY;
            const modelTailX = modelCurveEndX + tailDirX * tailLengthVal;
            const modelTailY = modelCurveEndY + tailDirY * tailLengthVal;
           
            const svgStart = transformCoord(modelStartX, modelStartY);
            const svgCp1 = transformCoord(modelCp1X, modelCp1Y);
            const svgCp2 = transformCoord(modelCp2X, modelCp2Y);
            const svgCurveEnd = transformCoord(modelCurveEndX, modelCurveEndY);
            const svgTail = transformCoord(modelTailX, modelTailY);
            foldPath = `M${svgStart.x},${svgStart.y} C${svgCp1.x},${svgCp1.y} ${svgCp2.x},${svgCp2.y} ${svgCurveEnd.x},${svgCurveEnd.y} L${svgTail.x},${svgTail.y}`;
          } else {
            let foldAngleVal = flipped ? 360 - foldAngle : foldAngle;
            const foldAngleRad = foldAngleVal * Math.PI / 180;
            const baseDirX = isFirstSegment ? unitX : -unitX;
            const baseDirY = isFirstSegment ? unitY : -unitY;
            const foldDirX = baseDirX * Math.cos(foldAngleRad) - baseDirY * Math.sin(foldAngleRad);
            const foldDirY = baseDirX * Math.sin(foldAngleRad) + baseDirY * Math.cos(foldAngleRad);
            const modelFoldEndX = modelFoldBaseX + foldDirX * foldLength;
            const modelFoldEndY = modelFoldBaseY + foldDirY * foldLength;
            const svgBase = transformCoord(modelFoldBaseX, modelFoldBaseY);
            const svgEnd = transformCoord(modelFoldEndX, modelFoldEndY);
            foldPath = `M${svgBase.x},${svgBase.y} L${svgEnd.x},${svgEnd.y}`;
          }
         
          foldElement = `<path d="${foldPath}" stroke="#000000" stroke-width="${foldStroke}" fill="none" filter="url(#dropShadow)"/>`;
          const calculatedFoldLabelPos = calculateFoldLabelPosition(
            segment, isFirstSegment, p1, p2, foldType, foldAngle, flipped
          );
          const foldLabelKey = `fold-${path.pathIndex}-${i}`;
          const foldLabelPos = calculatedFoldLabelPos || labelPositions[foldLabelKey];
          if (foldLabelPos) {
            const {x: foldLabelX, y: foldLabelY} = transformCoord(foldLabelPos.x, foldLabelPos.y);
            const foldLabelText = foldType.toUpperCase();
            const foldLabelWidth = Math.max(80, foldLabelText.length * (fontSize * 0.6) + 20);
           
            let foldTailPath = '';
            const {x: targetX, y: targetY} = transformCoord(modelFoldBaseX, modelFoldBaseY);
            const foldLabelDx = targetX - foldLabelX;
            const foldLabelDy = targetY - foldLabelY;
            const absFoldLabelDx = Math.abs(foldLabelDx);
            const absFoldLabelDy = Math.abs(foldLabelDy);
            if (absFoldLabelDx > absFoldLabelDy) {
              if (foldLabelDx < 0) {
                const baseX = foldLabelX - foldLabelWidth / 2;
                foldTailPath = `M${baseX} ${foldLabelY - attachSz/2} L${baseX} ${foldLabelY + attachSz/2} L${baseX - tailSz} ${foldLabelY} Z`;
              } else {
                const baseX = foldLabelX + foldLabelWidth / 2;
                foldTailPath = `M${baseX} ${foldLabelY - attachSz/2} L${baseX} ${foldLabelY + attachSz/2} L${baseX + tailSz} ${foldLabelY} Z`;
              }
            } else {
              if (foldLabelDy < 0) {
                const baseY = foldLabelY - labelH / 2;
                foldTailPath = `M${foldLabelX - attachSz/2} ${baseY} L${foldLabelX + attachSz/2} ${baseY} L${foldLabelX} ${baseY - tailSz} Z`;
              } else {
                const baseY = foldLabelY + labelH / 2;
                foldTailPath = `M${foldLabelX - attachSz/2} ${baseY} L${foldLabelX + attachSz/2} ${baseY} L${foldLabelX} ${baseY + tailSz} Z`;
              }
            }
            foldElement += `
              <g filter="url(#dropShadow)">
                <rect x="${foldLabelX - foldLabelWidth/2}" y="${foldLabelY - labelH/2}"
                      width="${foldLabelWidth}" height="${labelH}"
                      fill="${labelBg}" rx="${labelRx}"
                      stroke="#000000" stroke-width="0.5"/>
                <path d="${foldTailPath}" fill="${tailFill}"/>
                <text x="${foldLabelX}" y="${foldLabelY}" font-size="${fontSize}" font-family="Helvetica" font-weight="bold"
                      fill="${labelTextColor}" text-anchor="middle" dominant-baseline="middle">
                  ${foldLabelText}
                </text>
              </g>
            `;
          }
        }
      }
    }
    return `
      <g filter="url(#dropShadow)">
        <rect x="${posX - labelWidth/2}" y="${posY - labelH/2}"
              width="${labelWidth}" height="${labelH}"
              fill="${labelBg}" rx="${labelRx}"
              stroke="#000000" stroke-width="0.5"/>
        <path d="${tailPath}" fill="${tailFill}"/>
        <text x="${posX}" y="${posY}" font-size="${fontSize}" font-family="Helvetica" font-weight="bold"
              fill="${labelTextColor}" text-anchor="middle" dominant-baseline="middle">
          ${textContent}
        </text>
      </g>
      ${foldElement}
    `;
  }).join('');
  // ── Angle labels ──────────────────────────────────────────
  svgContent += (Array.isArray(path.angles) ? path.angles : []).map((angle) => {
    if (!angle.labelPosition || typeof angle.labelPosition.x === 'undefined' || typeof angle.labelPosition.y === 'undefined') {
      return '';
    }
    const angleValue = parseFloat(angle.angle.replace(/°/g, ''));
    const roundedValue = Math.round(angleValue);
    if (roundedValue === 90 || roundedValue === 270 || roundedValue === 45 || roundedValue === 315) {
      return '';
    }
    const {x: posX, y: posY} = transformCoord(angle.labelPosition.x, angle.labelPosition.y);
    const vertexX = angle.vertexIndex && path.points[angle.vertexIndex] ? path.points[angle.vertexIndex].x : angle.labelPosition.x;
    const vertexY = angle.vertexIndex && path.points[angle.vertexIndex] ? path.points[angle.vertexIndex].y : angle.labelPosition.y;
    const {x: targetX, y: targetY} = transformCoord(vertexX, vertexY);
    const labelDx = targetX - posX;
    const labelDy = targetY - posY;
    const absLabelDx = Math.abs(labelDx);
    const absLabelDy = Math.abs(labelDy);
    const textContent = `${roundedValue}°`;
    const approxTextWidth = textContent.length * (fontSize * 0.6);
    const labelWidth = Math.max(80, approxTextWidth + 20);
    let tailPath = '';
    if (absLabelDx > absLabelDy) {
      if (labelDx < 0) {
        const baseX = posX - labelWidth / 2;
        tailPath = `M${baseX} ${posY - attachSz/2} L${baseX} ${posY + attachSz/2} L${baseX - tailSz} ${posY} Z`;
      } else {
        const baseX = posX + labelWidth / 2;
        tailPath = `M${baseX} ${posY - attachSz/2} L${baseX} ${posY + attachSz/2} L${baseX + tailSz} ${posY} Z`;
      }
    } else {
      if (labelDy < 0) {
        const baseY = posY - labelH / 2;
        tailPath = `M${posX - attachSz/2} ${baseY} L${posX + attachSz/2} ${baseY} L${posX} ${baseY - tailSz} Z`;
      } else {
        const baseY = posY + labelH / 2;
        tailPath = `M${posX - attachSz/2} ${baseY} L${posX + attachSz/2} ${baseY} L${posX} ${baseY + tailSz} Z`;
      }
    }
    return `
      <g filter="url(#dropShadow)">
        <rect x="${posX - labelWidth/2}" y="${posY - labelH/2}"
              width="${labelWidth}" height="${labelH}"
              fill="${labelBg}" rx="${labelRx}"
              stroke="#000000" stroke-width="0.5"/>
        <path d="${tailPath}" fill="${tailFill}"/>
        <text x="${posX}" y="${posY}" font-size="${fontSize}" font-family="Helvetica" font-weight="bold"
              fill="${labelTextColor}" text-anchor="middle" dominant-baseline="middle">
          ${roundedValue}°
        </text>
      </g>
    `;
  }).join('');
  // ── Commit labels ─────────────────────────────────────────
  commits.forEach((commit) => {
    if (commit.position) {
      const {x: posX, y: posY} = transformCoord(commit.position.x, commit.position.y);
      const commitMessage = commit.message || 'Commit';
      const commitWidth = Math.max(80, commitMessage.length * (fontSize * 0.6) + 20);
     
      svgContent += `
        <g filter="url(#dropShadow)">
          <rect x="${posX - commitWidth/2}" y="${posY - labelH/2}"
                width="${commitWidth}" height="${labelH}"
                fill="${COLORS.commitBg}" rx="${labelRx}"
                stroke="#000000" stroke-width="0.5"/>
          <text x="${posX}" y="${posY}" font-size="${fontSize}" font-family="Helvetica" font-weight="bold"
                fill="${COLORS.commitText}" text-anchor="middle" dominant-baseline="middle">
            ${commitMessage}
          </text>
        </g>
      `;
    }
  });
  return `<svg width="100%" height="100%" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">
    ${svgDefs}
    <g>${gridLines}</g>
    <g>${svgContent}</g>
  </svg>`;
};

// ========== drawHeader ==========
const drawHeader = (doc, pageWidth, y, headerInfo = null, logoBuffer = null) => {
  const margin = 50;
  const defaultInfo = {
    name: 'COMMERCIAL ROOFERS PTY LTD',
    contact: 'info@commercialroofers.net.au | 0421259430',
    tagline: 'Professional Roofing Solutions'
  };
  const info = headerInfo || defaultInfo;
  doc.rect(0, 0, pageWidth, 80).fill('#FFFFFF');
  doc.font(FONTS.title).fontSize(18).fillColor(COLORS.darkText).text(info.name, margin, 15);
  doc.font(FONTS.body).fontSize(11).fillColor(COLORS.darkText).text(info.contact, margin, 40);
  doc.font(FONTS.italic).fontSize(10).fillColor(COLORS.darkText).text(info.tagline, margin, 55);
  try {
    if (logoBuffer) {
      const logoHeight = 50;
      const logoWidth = (doc.openImage(logoBuffer).width * logoHeight) / doc.openImage(logoBuffer).height;
      doc.image(logoBuffer, pageWidth - margin - logoWidth, 15, { width: logoWidth, height: logoHeight });
    } else {
      const logo = doc.openImage(logoPath);
      const logoHeight = 50;
      const logoWidth = (logo.width * logoHeight) / logo.height;
      doc.image(logo, pageWidth - margin - logoWidth, 15, { width: logoWidth, height: logoHeight });
    }
  } catch (err) {
    console.warn('Failed to load logo:', err.message);
  }
  doc.moveTo(margin, 75).lineTo(pageWidth - margin, 75)
     .strokeColor(COLORS.border).dash(5, { space: 3 }).lineWidth(1).stroke();
  return y + 85;
};

// Helper function to draw section header (kept from original)
const drawSectionHeader = (doc, text, y) => {
  const margin = 50;
  doc.rect(margin, y, doc.page.width - 2 * margin, 25).fill(COLORS.lightBg);
  doc.rect(margin, y, 5, 25).fill(COLORS.secondary);
  doc.font(FONTS.subtitle).fontSize(15).fillColor(COLORS.primary).text(text, margin + 15, y + 5);
  return y + 35;
};

// ---------- NEW / MODIFIED FUNCTIONS ----------

/**
 * Draws the info grid (Job Reference, Order Contact, etc.)
 * Matches the HTML layout: two columns, labels bold.
 */
const drawInfoGrid = (doc, jobRef, orderContact, orderDate, deliveryAddress, y) => {
  const margin = 50;
  const pageWidth = doc.page.width;
  const col1X = margin;
  const col2X = margin + 140;
  const lineHeight = 20;
  const fontSize = 11;
  const rows = [
    { label: 'Job Reference', value: jobRef },
    { label: 'Order Contact', value: orderContact },
    { label: 'Order Date', value: orderDate },
    { label: 'Delivery Address', value: deliveryAddress || 'PICKUP' }
  ];
  rows.forEach((row, i) => {
    const rowY = y + i * lineHeight;
    doc.font(FONTS.tableHeader).fontSize(fontSize).fillColor(COLORS.darkText)
       .text(row.label, col1X, rowY, { continued: false });
    doc.font(FONTS.body).fontSize(fontSize).fillColor(COLORS.darkText)
       .text(row.value, col2X, rowY);
  });
  return y + rows.length * lineHeight;
};

/**
 * Draws the notes section (bullet points + red warning)
 */
const drawNotes = (doc, y) => {
  const margin = 50;
  const pageWidth = doc.page.width;
  const bullet = '•';
  const notes = [
    'Arrow points to the (solid) coloured side',
    '90° degrees are not labelled',
    'F = Total number of folds, each crush counts as 2 folds'
  ];
  doc.font(FONTS.body).fontSize(10).fillColor(COLORS.darkText);
  notes.forEach((note, i) => {
    doc.text(`${bullet} ${note}`, margin, y + i * 16);
  });
  const warningY = y + notes.length * 16 + 6;
  doc.font(FONTS.subtitle).fontSize(11).fillColor(COLORS.accent)
     .text('*** PLEASE WRITE ALL ', margin, warningY, { continued: true })
     .fillColor('red').text('CODES', { continued: true })
     .fillColor(COLORS.accent).text(' ON FLASHINGS ***');
  return warningY + 30;
};

/**
 * Draws a single flashing card (header, data row, QxL, diagram, frame)
 */
const drawFlashingCard = async (doc, x, y, cardWidth, pathData, qxlGroup, pathIndex, scale, showBorder,
                          borderOffsetDirection, labelPositions, commits, showOppositeLines,
                          oppositeLinesDirection) => {
  const headerHeight = 22;
  const dataRowHeight = 22;
  const qxlRowHeight = 22;
  const diagramHeight = 200; // fixed height for consistency
  const innerPadding = 4;
  // Card border (thin)
  doc.rect(x, y, cardWidth, headerHeight + dataRowHeight + qxlRowHeight + diagramHeight)
     .lineWidth(1).strokeColor('#555').stroke();
  // ---------- HEADER ROW ----------
  const headerY = y;
  doc.rect(x, headerY, cardWidth, headerHeight).fill('#f0f0f0'); // light grey background
  doc.lineWidth(0.5).strokeColor('#999').rect(x, headerY, cardWidth, headerHeight).stroke();
  // Adjusted column widths to fit cardWidth (~237pt)
  const colWidths = [25, 95, 40, 28, 40]; // sum = 228 (safe for card)
  let colX = x + 2;
  const headers = ['#', 'Colour / Material', 'CODE', 'F', 'GIRTH'];
  doc.font(FONTS.tableHeader).fontSize(9).fillColor('#222');
  headers.forEach((h, i) => {
    doc.text(h, colX + 2, headerY + 5, { width: colWidths[i] - 4, align: 'center' });
    colX += colWidths[i];
  });
  // ---------- DATA ROW ----------
  const dataY = headerY + headerHeight;
  doc.rect(x, dataY, cardWidth, dataRowHeight).fill('#ffffff').strokeColor('#ddd').stroke();
  const num = (pathIndex + 1).toString();
  const color = pathData.color || 'Shale Grey';
  const code = (pathData.code || '').replace(/\D/g, '');
  const totalFolds = calculateTotalFolds(pathData).toString();
  const girth = `${calculateGirth(pathData)}mm`;
  const dataValues = [num, color, code, totalFolds, girth];
  colX = x + 2;
  doc.font(FONTS.body).fontSize(10).fillColor('#000');
  dataValues.forEach((val, i) => {
    const align = i === 2 ? 'center' : (i === 0 || i === 3 || i === 4 ? 'center' : 'left');
    const colorCode = i === 2 ? COLORS.accent : '#000';
    doc.fillColor(colorCode).text(val, colX + 2, dataY + 5, { width: colWidths[i] - 4, align });
    colX += colWidths[i];
  });
  doc.fillColor('#000');
  // ---------- Q x L ROW ----------
  const qxlY = dataY + dataRowHeight;
  doc.rect(x, qxlY, cardWidth, qxlRowHeight).fill('#fafafa').strokeColor('#ddd').stroke();
  const qxlStr = formatQxL(qxlGroup);
  let totalM = 0;
  qxlGroup.forEach(item => { totalM += item.quantity * parseFloat(item.length) / 1000; });
  const totalStr = totalM.toFixed(1);
  doc.font(FONTS.tableHeader).fontSize(10).fillColor('#000')
     .text(`Q x L ${qxlStr}`, x + 6, qxlY + 5, { width: cardWidth - 80 });
  doc.font(FONTS.tableHeader).fontSize(10).fillColor('#000')
     .text(`T - ${totalStr}`, x + cardWidth - 60, qxlY + 5, { width: 50, align: 'right' });
  // ---------- DIAGRAM AREA ----------
  const diagramY = qxlY + qxlRowHeight;
  const diagramArea = { 
    x: x + innerPadding, 
    y: diagramY + innerPadding,
    width: cardWidth - 2 * innerPadding, 
    height: diagramHeight - 2 * innerPadding 
  };
  // Generate SVG and convert to PNG buffer
  try {
    const bounds = calculateBounds(pathData, scale, showBorder, borderOffsetDirection,
                                  labelPositions, commits, showOppositeLines, oppositeLinesDirection);
    const svgString = generateSvgString(pathData, bounds, scale, showBorder, borderOffsetDirection,
                                        labelPositions, commits, showOppositeLines, oppositeLinesDirection);
    const imageBuffer = await sharp(Buffer.from(svgString))
      .resize({ 
        width: Math.round(diagramArea.width * 4), 
        height: Math.round(diagramArea.height * 4), 
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 } 
      })
      .png({ quality: 100, compressionLevel: 9, effort: 10, palette: true })
      .toBuffer();
    doc.image(imageBuffer, diagramArea.x, diagramArea.y, {
      width: diagramArea.width,
      height: diagramArea.height
    });
  } catch (err) {
    console.warn(`Diagram render error for path ${pathIndex}:`, err.message);
    doc.font('Helvetica').fontSize(10).fillColor('red')
       .text('Diagram unavailable', diagramArea.x, diagramArea.y + 20);
  }
  // Inner border around diagram
  doc.rect(diagramArea.x, diagramArea.y, diagramArea.width, diagramArea.height)
     .lineWidth(0.5).strokeColor('#aaa').stroke();
  return y + headerHeight + dataRowHeight + qxlRowHeight + diagramHeight;
};

/**
 * Draws the footer with supplier link
 */
const drawFooter = (doc, pageWidth, pageHeight) => {
  const margin = 50;
  doc.moveTo(margin, pageHeight - 40).lineTo(pageWidth - margin, pageHeight - 40)
     .strokeColor('#bbb').lineWidth(0.5).stroke();
  doc.font(FONTS.body).fontSize(10).fillColor('#333')
     .text('Suppliers: ', margin, pageHeight - 30, { continued: true })
     .font(FONTS.tableHeader).fillColor('#000')
     .text('Automate these orders @ www.flashit.app/supplier');
};

// ---------- MAIN PDF GENERATION FUNCTION ----------
export const generatePdfDownload = async (req, res) => {
  try {
    const { selectedProjectData, JobReference, Number, OrderContact, OrderDate,
            DeliveryAddress, PickupNotes, Notes, AdditionalItems } = req.body;
    const { userId } = req.params;

    // --- Validation & Setup ---
    if (!JobReference || !Number || !OrderContact || !OrderDate) {
      return res.status(400).json({ message: 'JobReference, Number, OrderContact, and OrderDate are required' });
    }
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Valid userId is required' });
    }
    if (!uploadsDir) {
      return res.status(500).json({ message: 'Uploads directory is not defined' });
    }
    const QuantitiesAndLengths = selectedProjectData?.QuantitiesAndLengths || [];
    if (!Array.isArray(QuantitiesAndLengths) || QuantitiesAndLengths.length === 0) {
      return res.status(400).json({ message: 'QuantitiesAndLengths must be a non-empty array' });
    }
    for (const item of QuantitiesAndLengths) {
      if (!item.quantity || !item.length || isNaN(parseFloat(item.quantity)) || isNaN(parseFloat(item.length))) {
        return res.status(400).json({ message: 'Each QuantitiesAndLengths item must have valid numeric quantity and length' });
      }
    }
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    let logoBuffer = null;
    let headerInfo = null;
    if (user.company) {
      try {
        const company = await CompanyList.findOne({ userId: user._id });
        if (company) {
          if (company.companyImage && company.companyImage.length > 0) {
            const imageUrl = company.companyImage[0].url;
            const response = await fetch(imageUrl);
            if (response.ok) {
              const arrayBuffer = await response.arrayBuffer();
              logoBuffer = Buffer.from(arrayBuffer);
            }
          }
          const contactEmail = user.email || 'info@commercialroofers.net.au';
          const phone = company.phone ? ` | ${company.phone}` : '';
          headerInfo = {
            name: company.companyName || 'COMMERCIAL ROOFERS PTY LTD',
            contact: contactEmail + phone,
            tagline: 'Professional Roofing Solutions'
          };
        }
      } catch (err) {
        console.warn('Error fetching company details:', err.message);
      }
    }
    if (!headerInfo) {
      headerInfo = {
        name: 'COMMERCIAL ROOFERS PTY LTD',
        contact: 'info@commercialroofers.net.au | 0421259430',
        tagline: 'Professional Roofing Solutions'
      };
    }
    let projectData;
    try {
      projectData = typeof selectedProjectData === 'string' ? JSON.parse(selectedProjectData) : selectedProjectData;
      if (!projectData?.paths?.length) throw new Error('No valid paths');
    } catch (error) {
      return res.status(400).json({ message: 'Invalid project data' });
    }
    const scale = parseFloat(projectData.scale) || 1;
    const showBorder = projectData.showBorder || false;
    const borderOffsetDirection = projectData.borderOffsetDirection || 'inside';
    const labelPositions = projectData.labelPositions || {};
    const showOppositeLines = projectData.showOppositeLines || false;
    const oppositeLinesDirection = projectData.oppositeLinesDirection || 'far';
    const commits = projectData.commits || [];
    const validPaths = projectData.paths.filter(path => validatePoints(path.points));
    if (validPaths.length === 0) {
      return res.status(400).json({ message: 'No valid paths found in project data' });
    }
    // Group quantities per path
    const itemsPerPath = Math.ceil(QuantitiesAndLengths.length / validPaths.length);
    const groupedQuantitiesAndLengths = [];
    for (let i = 0; i < validPaths.length; i++) {
      const start = i * itemsPerPath;
      const end = Math.min(start + itemsPerPath, QuantitiesAndLengths.length);
      groupedQuantitiesAndLengths.push(QuantitiesAndLengths.slice(start, end));
    }
    // --- PDF Creation ---
    const doc = new PDFDocument({ 
      size: 'A4', 
      bufferPages: true, 
      margins: { top: 0, bottom: 0, left: 0, right: 0 } 
    });
    const timestamp = Date.now();
    const pdfPath = path.join(uploadsDir, `project-${timestamp}.pdf`);
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);
    const margin = 50;
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const cardGap = 20;
    const cardWidth = (pageWidth - 2 * margin - cardGap) / 2;
    const rowHeight = 270; // header(22) + data(22) + qxl(22) + diagram(200) + padding

    // --- First Page ---
    doc.addPage();
    let y = drawHeader(doc, pageWidth, 0, headerInfo, logoBuffer);
    // Info grid
    const poNumber = user.phoneNumber || Number;
    const orderContact = user.username || OrderContact;
    y = drawInfoGrid(doc, JobReference, orderContact, OrderDate, DeliveryAddress || PickupNotes, y + 10);
    // Notes
    y = drawNotes(doc, y + 10);
    // Section title
    y = drawSectionHeader(doc, 'FLASHING DETAILS', y);

    // --- Draw cards (two per row with automatic pagination) ---
    let currentYForCards = y;
    let cardsDrawnOnPage = 0;
    for (let i = 0; i < validPaths.length; i++) {
      let col = cardsDrawnOnPage % 2;
      let rowOffset = Math.floor(cardsDrawnOnPage / 2) * rowHeight;
      let cardX = margin + col * (cardWidth + cardGap);
      let cardY = currentYForCards + rowOffset;

      // New page if card does not fit
      if (cardY + rowHeight > pageHeight - 80) {
        doc.addPage();
        currentYForCards = drawHeader(doc, pageWidth, 0, headerInfo, logoBuffer);
        currentYForCards = drawSectionHeader(doc, 'FLASHING DETAILS (CONTINUED)', currentYForCards);
        cardsDrawnOnPage = 0;
        col = 0;
        rowOffset = 0;
        cardX = margin;
        cardY = currentYForCards;
      }

      await drawFlashingCard(doc, cardX, cardY, cardWidth, validPaths[i],
                             groupedQuantitiesAndLengths[i], i, scale, showBorder,
                             borderOffsetDirection, labelPositions, commits,
                             showOppositeLines, oppositeLinesDirection);
      cardsDrawnOnPage++;
    }

    // --- Footer on every page ---
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      drawFooter(doc, pageWidth, pageHeight);
    }
    doc.flushPages();
    doc.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // --- Upload to Cloudinary & save record ---
    const exists = await fsPromises.access(pdfPath).then(() => true).catch(() => false);
    if (!exists) {
      return res.status(500).json({ message: 'PDF file not generated' });
    }
    let uploadResult;
    try {
      uploadResult = await cloudinary.uploader.upload(pdfPath, {
        folder: 'freelancers',
        resource_type: 'raw',
        access_mode: 'public',
      });
    } catch (uploadError) {
      return res.status(500).json({ message: 'Failed to upload PDF to Cloudinary', error: uploadError.message });
    }
    if (!uploadResult || !uploadResult.public_id || !uploadResult.secure_url) {
      return res.status(500).json({ message: 'Invalid Cloudinary upload result' });
    }
    try {
      await new UserPdf({ userId, pdfUrl: uploadResult.secure_url }).save();
    } catch (dbError) {
      return res.status(500).json({ message: 'Failed to save order in database', error: dbError.message });
    }
    try {
      await fsPromises.unlink(pdfPath);
    } catch (deleteError) {
      console.warn('Failed to delete local PDF:', deleteError.message);
    }

    return res.status(200).json({
      message: 'PDF generated successfully',
      localPath: pdfPath,
      cloudinaryUrl: uploadResult.secure_url,
    });
  } catch (error) {
    console.error('GeneratePdf error:', error.message);
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};
