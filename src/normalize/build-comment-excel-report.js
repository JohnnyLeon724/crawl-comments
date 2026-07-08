#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_AI_REVIEW_DIR = 'ai-review-input';
const DEFAULT_REPORT_NAME = 'comment-report.xlsx';

function printUsage() {
  console.log(`
用法：
  node script/build-comment-excel-report.js --run-dir output/run_001
  node script/build-comment-excel-report.js --comments normalized-comments.jsonl --ai-review ai-review-input --out comment-report.xlsx

参数：
  --run-dir    可选，自动推导 normalized-comments.jsonl、ai-review-input、comment-report.xlsx
  --comments   可选，normalized-comments.jsonl 路径；未使用 --run-dir 时必填
  --ai-review  可选，AI 审阅 JSON 文件或包含 manifest/review_*.json 的目录；未使用 --run-dir 时必填
  --out        可选，xlsx 输出路径；未使用 --run-dir 时必填
  --help       查看帮助
`.trim());
}

function readFlagValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} 需要一个值`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    runDir: '',
    comments: '',
    aiReview: '',
    out: '',
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    if (token === '--run-dir') {
      args.runDir = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--comments') {
      args.comments = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--ai-review') {
      args.aiReview = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--out') {
      args.out = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    throw new Error(`未知参数：${token}`);
  }

  if (args.help) return args;

  if (args.runDir) {
    args.comments = args.comments || path.join(args.runDir, 'normalized-comments.jsonl');
    args.aiReview = args.aiReview || path.join(args.runDir, DEFAULT_AI_REVIEW_DIR);
    args.out = args.out || path.join(args.runDir, DEFAULT_REPORT_NAME);
  }

  if (!args.comments) throw new Error('必须提供 --comments 或 --run-dir');
  if (!args.aiReview) throw new Error('必须提供 --ai-review 或 --run-dir');
  if (!args.out) throw new Error('必须提供 --out 或 --run-dir');

  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function normalizeReviewRows(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.results)) return value.results;
  if (value && Array.isArray(value.rows)) return value.rows;
  return [];
}

function resolveReviewOutputPath(rawPath, baseDir) {
  if (path.isAbsolute(rawPath)) return rawPath;
  if (fs.existsSync(rawPath)) return rawPath;
  return path.join(baseDir, rawPath);
}

function readAiReviewRows(inputPath) {
  const stat = fs.statSync(inputPath);

  if (stat.isFile()) {
    return normalizeReviewRows(readJson(inputPath));
  }

  const manifestPath = path.join(inputPath, 'manifest.json');
  const files = [];

  if (fs.existsSync(manifestPath)) {
    const manifest = readJson(manifestPath);
    const batches = Array.isArray(manifest.batches) ? manifest.batches : [];

    for (const batch of batches) {
      if (!batch || !batch.output_file) continue;
      const outputFile = resolveReviewOutputPath(batch.output_file, inputPath);
      if (fs.existsSync(outputFile)) files.push(outputFile);
    }
  }

  if (!files.length) {
    for (const entry of fs.readdirSync(inputPath).sort()) {
      if (/^review_\d+\.json$/i.test(entry)) {
        files.push(path.join(inputPath, entry));
      }
    }
  }

  return files.flatMap(filePath => normalizeReviewRows(readJson(filePath)));
}

function emptyReview() {
  return {
    sentiment: '',
    negative_theme: '',
    reason: '',
    confidence: ''
  };
}

function mergeCommentWithReview(comment, review) {
  const ai = review || emptyReview();

  return {
    row_key: String(comment.row_key || ''),
    platform: String(comment.platform || ''),
    source_url: String(comment.source_url || ''),
    post_id: String(comment.post_id || ''),
    row_type: String(comment.row_type || ''),
    user_name: String(comment.user_name || ''),
    text: String(comment.text || ''),
    created_at: String(comment.created_at || ''),
    like_count: Number.isFinite(Number(comment.like_count)) ? Number(comment.like_count) : 0,
    reply_to_user_name: String(comment.reply_to_user_name || ''),
    root_text: String(comment.root_text || ''),
    sentiment: String(ai.sentiment || ''),
    negative_theme: String(ai.negative_theme || ''),
    ai_reason: String(ai.reason || ''),
    confidence: String(ai.confidence || '')
  };
}

function buildReviewIndex(reviewRows) {
  const index = new Map();

  for (const row of reviewRows) {
    if (!row || !row.row_key) continue;
    index.set(String(row.row_key), {
      row_key: String(row.row_key),
      sentiment: String(row.sentiment || ''),
      negative_theme: String(row.negative_theme || ''),
      reason: String(row.reason || ''),
      confidence: String(row.confidence || '')
    });
  }

  return index;
}

function buildReportModel(commentRows, reviewRows) {
  const reviewIndex = buildReviewIndex(reviewRows);
  const mergedRows = commentRows.map(row => mergeCommentWithReview(row, reviewIndex.get(String(row.row_key || ''))));
  const reviewedRows = mergedRows.filter(row => row.sentiment);
  const positiveRows = mergedRows.filter(row => row.sentiment === '正面');
  const negativeRows = mergedRows.filter(row => row.sentiment === '负面');
  const neutralRows = mergedRows.filter(row => row.sentiment === '中性');

  return {
    generated_at: new Date().toISOString(),
    summary: {
      total_comments: mergedRows.length,
      reviewed_comments: reviewedRows.length,
      positive_comments: positiveRows.length,
      negative_comments: negativeRows.length,
      neutral_comments: neutralRows.length,
      missing_review_comments: mergedRows.length - reviewedRows.length
    },
    sheets: {
      allComments: {
        name: '全部评论',
        columns: COMMENT_COLUMNS,
        rows: mergedRows
      },
      negativeComments: {
        name: '负面评论',
        columns: COMMENT_COLUMNS,
        rows: negativeRows
      },
      positiveComments: {
        name: '正面评论',
        columns: COMMENT_COLUMNS,
        rows: positiveRows
      },
      aiDetails: {
        name: 'AI明细',
        columns: AI_COLUMNS,
        rows: reviewRows.map(row => ({
          row_key: String(row.row_key || ''),
          sentiment: String(row.sentiment || ''),
          negative_theme: String(row.negative_theme || ''),
          reason: String(row.reason || ''),
          confidence: String(row.confidence || '')
        })).filter(row => row.row_key)
      }
    }
  };
}

const COMMENT_COLUMNS = [
  { field: 'row_key', label: 'row_key', width: 18 },
  { field: 'sentiment', label: '情感', width: 10 },
  { field: 'negative_theme', label: '负面主题', width: 14 },
  { field: 'ai_reason', label: 'AI依据', width: 30 },
  { field: 'confidence', label: '置信度', width: 10 },
  { field: 'platform', label: '平台', width: 10 },
  { field: 'row_type', label: '层级', width: 10 },
  { field: 'user_name', label: '昵称', width: 16 },
  { field: 'text', label: '评论内容', width: 44 },
  { field: 'like_count', label: '点赞数', width: 10 },
  { field: 'created_at', label: '采集时间', width: 22 },
  { field: 'reply_to_user_name', label: '回复对象', width: 16 },
  { field: 'root_text', label: '一级评论', width: 36 },
  { field: 'source_url', label: '来源链接', width: 48 }
];

const AI_COLUMNS = [
  { field: 'row_key', label: 'row_key', width: 18 },
  { field: 'sentiment', label: '情感', width: 10 },
  { field: 'negative_theme', label: '负面主题', width: 14 },
  { field: 'reason', label: 'AI依据', width: 36 },
  { field: 'confidence', label: '置信度', width: 10 }
];

function buildSummaryMatrix(model) {
  return [
    ['评论分析报表'],
    [],
    ['指标', '数值'],
    ['总评论数', model.summary.total_comments],
    ['已AI结构化', model.summary.reviewed_comments],
    ['正面评论数', model.summary.positive_comments],
    ['负面评论数', model.summary.negative_comments],
    ['中性评论数', model.summary.neutral_comments],
    ['未匹配AI结果', model.summary.missing_review_comments],
    ['生成时间', model.generated_at]
  ];
}

function buildTableMatrix(sheet) {
  return [
    [sheet.name],
    [],
    sheet.columns.map(column => column.label),
    ...sheet.rows.map(row => sheet.columns.map(column => row[column.field] == null ? '' : row[column.field]))
  ];
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index) {
  let value = index + 1;
  let name = '';

  while (value > 0) {
    const modulo = (value - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    value = Math.floor((value - modulo) / 26);
  }

  return name;
}

function visibleLength(value) {
  return Array.from(String(value == null ? '' : value)).length;
}

function calculateColumnWidths(matrix, providedWidths = []) {
  const columnCount = Math.max(...matrix.map(row => row.length), 1);
  const widths = [];

  for (let column = 0; column < columnCount; column += 1) {
    const maxContent = matrix.reduce((max, row) => Math.max(max, visibleLength(row[column])), 0);
    const provided = providedWidths[column] || 0;
    widths.push(Math.min(Math.max(provided, maxContent + 4, 10), 60));
  }

  return widths;
}

function cellXml(rowIndex, columnIndex, value, styleIndex) {
  if (value == null || value === '') return '';

  const ref = `${columnName(columnIndex)}${rowIndex}`;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" s="${styleIndex || 5}"><v>${value}</v></c>`;
  }

  return `<c r="${ref}" t="inlineStr" s="${styleIndex || 3}"><is><t>${escapeXml(value)}</t></is></c>`;
}

function matrixToWorksheetXml(matrix, options = {}) {
  const sheetRows = matrix.map((row, rowIndex) => {
    const excelRow = rowIndex + 1;
    const cells = row.map((value, columnIndex) => {
      let styleIndex = 3;

      if (excelRow === 1) styleIndex = 1;
      if (excelRow === options.headerRow) styleIndex = 2;
      if (options.summary && excelRow > 3 && columnIndex === 0) styleIndex = 4;

      return cellXml(excelRow, columnIndex, value, styleIndex);
    }).join('');
    const height = excelRow === 1 ? ' ht="24" customHeight="1"' : '';

    return `<row r="${excelRow}"${height}>${cells}</row>`;
  }).join('');
  const columnWidths = options.widths || calculateColumnWidths(matrix);
  const columns = columnWidths.map((width, index) => {
    const column = index + 1;
    return `<col min="${column}" max="${column}" width="${width}" customWidth="1"/>`;
  }).join('');
  const lastColumn = columnName(Math.max(...matrix.map(row => row.length), 1) - 1);
  const lastRow = Math.max(matrix.length, 1);
  const freeze = options.freezeRows
    ? `<pane ySplit="${options.freezeRows}" topLeftCell="A${options.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
    : '';
  const autoFilter = options.headerRow
    ? `<autoFilter ref="A${options.headerRow}:${lastColumn}${lastRow}"/>`
    : '';

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<dimension ref="A1:${lastColumn}${lastRow}"/>`,
    `<sheetViews><sheetView workbookViewId="0">${freeze}</sheetView></sheetViews>`,
    '<sheetFormatPr defaultRowHeight="18"/>',
    `<cols>${columns}</cols>`,
    `<sheetData>${sheetRows}</sheetData>`,
    autoFilter,
    '</worksheet>'
  ].join('');
}

function buildStylesXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<fonts count="3">',
    '<font><sz val="11"/><name val="Calibri"/></font>',
    '<font><b/><sz val="16"/><color rgb="FF1F2937"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',
    '</fonts>',
    '<fills count="4">',
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill>',
    '</fills>',
    '<borders count="2">',
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFD9E2EC"/></bottom><diagonal/></border>',
    '</borders>',
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
    '<cellXfs count="6">',
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>',
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>',
    '</cellXfs>',
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
    '</styleSheet>'
  ].join('');
}

function buildWorkbookParts(model) {
  const sheetDefs = [
    {
      name: '总结',
      matrix: buildSummaryMatrix(model),
      options: {
        summary: true,
        headerRow: 3,
        freezeRows: 3,
        widths: [22, 30]
      }
    },
    ...Object.values(model.sheets).map(sheet => {
      const matrix = buildTableMatrix(sheet);
      return {
        name: sheet.name,
        matrix,
        options: {
          headerRow: 3,
          freezeRows: 3,
          widths: calculateColumnWidths(matrix, sheet.columns.map(column => column.width || 12))
        }
      };
    })
  ];
  const worksheetOverrides = sheetDefs.map((_, index) => {
    return `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }).join('');
  const workbookSheets = sheetDefs.map((sheet, index) => {
    return `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`;
  }).join('');
  const workbookRelationships = sheetDefs.map((_, index) => {
    return `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`;
  }).join('');
  const createdAt = escapeXml(model.generated_at);
  const parts = {
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
      worksheetOverrides,
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
      '</Types>'
    ].join(''),
    '_rels/.rels': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>',
      '</Relationships>'
    ].join(''),
    'docProps/core.xml': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
      '<dc:creator>comment-crawler</dc:creator>',
      '<cp:lastModifiedBy>comment-crawler</cp:lastModifiedBy>',
      `<dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created>`,
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified>`,
      '</cp:coreProperties>'
    ].join(''),
    'docProps/app.xml': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">',
      '<Application>comment-crawler</Application>',
      '</Properties>'
    ].join(''),
    'xl/workbook.xml': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      `<sheets>${workbookSheets}</sheets>`,
      '</workbook>'
    ].join(''),
    'xl/_rels/workbook.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      workbookRelationships,
      `<Relationship Id="rId${sheetDefs.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
      '</Relationships>'
    ].join(''),
    'xl/styles.xml': buildStylesXml()
  };

  sheetDefs.forEach((sheet, index) => {
    parts[`xl/worksheets/sheet${index + 1}.xml`] = matrixToWorksheetXml(sheet.matrix, sheet.options);
  });

  return parts;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }

  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;

  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosTimestamp() {
  const year = 2026;
  const month = 1;
  const day = 1;
  const hours = 0;
  const minutes = 0;
  const seconds = 0;

  return {
    time: (hours << 11) | (minutes << 5) | Math.floor(seconds / 2),
    date: ((year - 1980) << 9) | (month << 5) | day
  };
}

function buildZip(parts) {
  const fileRecords = [];
  const localBuffers = [];
  let offset = 0;
  const timestamp = dosTimestamp();

  for (const [name, content] of Object.entries(parts)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(content);
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(timestamp.time, 10);
    localHeader.writeUInt16LE(timestamp.date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localBuffers.push(localHeader, nameBuffer, data);
    fileRecords.push({
      nameBuffer,
      checksum,
      size: data.length,
      offset
    });
    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralBuffers = [];
  let centralSize = 0;

  for (const record of fileRecords) {
    const centralHeader = Buffer.alloc(46);

    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(timestamp.time, 12);
    centralHeader.writeUInt16LE(timestamp.date, 14);
    centralHeader.writeUInt32LE(record.checksum, 16);
    centralHeader.writeUInt32LE(record.size, 20);
    centralHeader.writeUInt32LE(record.size, 24);
    centralHeader.writeUInt16LE(record.nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(record.offset, 42);

    centralBuffers.push(centralHeader, record.nameBuffer);
    centralSize += centralHeader.length + record.nameBuffer.length;
  }

  const centralOffset = offset;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(fileRecords.length, 8);
  end.writeUInt16LE(fileRecords.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localBuffers, ...centralBuffers, end]);
}

function buildWorkbookBuffer(model) {
  return buildZip(buildWorkbookParts(model));
}

function buildExcelReport(args) {
  const comments = readJsonl(args.comments);
  const reviews = readAiReviewRows(args.aiReview);
  const model = buildReportModel(comments, reviews);
  const buffer = buildWorkbookBuffer(model);

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, buffer);

  return {
    status: 'success',
    comments: args.comments,
    aiReview: args.aiReview,
    out: args.out,
    summary: model.summary
  };
}

async function main(argv = process.argv.slice(2)) {
  let args;

  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    printUsage();
    process.exitCode = 1;
    return null;
  }

  if (args.help) {
    printUsage();
    return null;
  }

  const result = buildExcelReport(args);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  readJsonl,
  readAiReviewRows,
  buildReportModel,
  buildWorkbookParts,
  buildWorkbookBuffer,
  buildExcelReport,
  main
};
