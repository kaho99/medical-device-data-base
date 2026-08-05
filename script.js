const form = document.getElementById('screeningForm');
const resultSummary = document.getElementById('resultSummary');
const resultTable = document.getElementById('resultTable');
const databaseList = document.getElementById('databaseList');
const copyButton = document.getElementById('copyTable');
const generateReportButton = document.getElementById('generateReport');
const exportPdfButton = document.getElementById('exportPdf');
const reportOutput = document.getElementById('reportOutput');
const useExampleButton = document.getElementById('useExample');
const clearFormButton = document.getElementById('clearForm');

let deviceRegistry = [];
let currentMatches = [];
let selectedDeviceIds = new Set();

if (!form || !resultSummary || !resultTable || !databaseList || !copyButton || !generateReportButton || !exportPdfButton || !reportOutput || !useExampleButton || !clearFormButton) {
  throw new Error('The screening page is missing required UI elements.');
}

function buildFallbackRegistry() {
  return [
    {
      id: 'asp-001',
      description: 'ASPIRATORS, AIRWAY',
      manufacturer: 'Laerdal',
      model: 'LCSU 4',
      objectType: 'Aspirator',
      issue: 'The service life of LCSU 4 units manufactured in the period 9 August 2018 to 6 June 2020 may be reduced due to weakness in the design and assembly process. The pump of the affected units may malfunction resulting in low suction levels or failure to provide suction.',
      keywords: ['aspirator', 'airway', 'suction', 'low suction', 'service life', 'pump']
    },
    {
      id: 'inf-001',
      description: 'INFUSION PUMPS',
      manufacturer: 'B. Braun',
      model: 'Perfusor Space',
      objectType: 'Infusion pump',
      issue: 'The infusion pump may over-infusate or under-infusate due to a software issue affecting dose accuracy during certain infusion profiles.',
      keywords: ['infusion', 'pump', 'dose accuracy', 'over-infuse', 'under-infuse']
    },
    {
      id: 'ven-001',
      description: 'VENTILATORS',
      manufacturer: 'Philips',
      model: 'V60',
      objectType: 'Ventilator',
      issue: 'The ventilator may fail to trigger alarms when a patient disconnection event occurs, leading to delayed recognition of circuit disconnection.',
      keywords: ['ventilator', 'alarm', 'disconnection', 'trigger']
    }
  ];
}

function toDeviceRecord(record, index) {
  const description = [record.description, record.intended, record.term].filter(Boolean)[0] || 'Medical device';
  const manufacturer = [record.manu, record.tc_manu, record.sc_manu, record.lrp].filter(Boolean)[0] || 'Not stated';
  const model = [record.brand_name, record.model, record.tc_brand_name, record.tc_model, record.sc_brand_name, record.sc_model]
    .filter(Boolean)
    .join(' - ') || 'Not stated';
  const objectType = description.split(',')[0] || 'Medical device';
  const keywordSource = [description, manufacturer, model, objectType, record.issue || ''].join(' ');
  const keywords = [description, manufacturer, model, objectType]
    .flatMap((value) => normalize(value).split(' '))
    .filter(Boolean)
    .slice(0, 18);
  const searchTokens = [...new Set(getMeaningfulTokens(keywordSource))];

  return {
    id: record.no || `mdd-${index}`,
    description: String(description).toUpperCase(),
    manufacturer: String(manufacturer),
    model: String(model),
    objectType: String(objectType),
    issue: 'Review this device record for potential relevance to the safety alert and confirm whether the alert applies to the listed device.',
    keywords: [...new Set(keywords)],
    searchTokens
  };
}

async function loadDeviceRegistry() {
  databaseList.innerHTML = '<div class="empty-state">Loading MDD device database…</div>';

  try {
    const responses = await Promise.allSettled([fetch('/api/devices'), fetch('./devices.json')]);
    const successfulResponse = responses.find((candidate) => candidate.status === 'fulfilled' && candidate.value?.ok);

    if (!successfulResponse) {
      throw new Error('Unable to load the MDD database from the local server.');
    }

    const response = successfulResponse.value;
    const payload = await response.json();
    const records = Array.isArray(payload.records) ? payload.records : [];

    if (!records.length) {
      throw new Error('No medical device records were returned.');
    }

    deviceRegistry = records.map((record, index) => toDeviceRecord(record, index));
    renderDatabase();
  } catch (error) {
    console.error(error);
    deviceRegistry = buildFallbackRegistry().map((record, index) => toDeviceRecord(record, index));
    renderDatabase();
  }
}

function normalize(value) {
  const rawText = String(value || '').toLowerCase();
  const normalizedValue = rawText.replace(/[^a-z0-9]+/g, ' ').trim();
  return normalizedValue.replace(/\b([a-z])(?:\s+([a-z])){1,2}\b/g, (_, first, second) => first + second);
}

function normalizeCompact(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function tokenize(value) {
  return normalize(value)
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeToken(token) {
  if (typeof token !== 'string') {
    return token;
  }

  const trimmed = token.trim();
  if (trimmed.length > 4 && trimmed.endsWith('s')) {
    return trimmed.slice(0, -1);
  }

  return trimmed;
}

function countMatchingTokens(tokens, tokenSet) {
  return new Set(
    tokens
      .map(normalizeToken)
      .filter((token) => token && tokenSet.has(token))
  ).size;
}

function fieldContainsPhrase(query, fieldValue) {
  const normalizedQuery = normalizeCompact(query);
  const normalizedField = normalizeCompact(fieldValue);
  return normalizedField && normalizedQuery.includes(normalizedField);
}

function getMeaningfulTokens(value) {
  const stopWords = new Set([
    'the', 'and', 'or', 'for', 'with', 'this', 'that', 'from', 'into', 'during', 'after',
    'before', 'may', 'can', 'will', 'due', 'been', 'were', 'was', 'are', 'is', 'be', 'of',
    'to', 'in', 'on', 'a', 'an', 'as', 'at', 'by', 'it', 'its', 'their', 'our', 'your',
    'device', 'devices', 'alert', 'safety', 'medical', 'related', 'situation', 'issue', 'noted',
    'units', 'unit', 'manufactured', 'manufacture', 'manufacturing', 'service', 'life', 'pump',
    'resulting', 'failure', 'provide', 'levels', 'low', 'high', 'part', 'parts',
    'recall', 'recalls', 'health', 'canada', 'link', 'url', 'www', 'http', 'https', 'en', 'ca'
  ]);

  return tokenize(value)
    .map(normalizeToken)
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function overlapScore(value, fieldValue) {
  const left = new Set(getMeaningfulTokens(value));
  const right = getMeaningfulTokens(fieldValue);
  if (!right.length) {
    return 0;
  }

  const matches = right.filter((token) => left.has(token)).length;
  return matches / right.length;
}

function renderDatabase() {
  const visibleDevices = deviceRegistry.slice(0, 80);
  const summary = deviceRegistry.length
    ? `<div class="summary-card"><strong>${deviceRegistry.length}</strong> MDD device records loaded. Showing the first 80 below.</div>`
    : '<div class="summary-card">No device records available.</div>';

  databaseList.innerHTML = `${summary}${visibleDevices
    .map(
      (device) => `
        <article class="db-item" role="listitem">
          <strong>${escapeHtml(device.description)}</strong>
          <div>${escapeHtml(device.manufacturer)}</div>
          <div>Model: ${escapeHtml(device.model)}</div>
          <div>Type: ${escapeHtml(device.objectType)}</div>
        </article>
      `
    )
    .join('')}`;
}

function getAlertField() {
  return document.getElementById('alertText');
}

function getAlertText() {
  const field = getAlertField();
  return field ? field.textContent.trim() : '';
}

function getAlertHtml() {
  const field = getAlertField();
  return field ? field.innerHTML.trim() : '';
}

function normalizeUrlForScreening(url) {
  try {
    const parsed = new URL(url);
    const segments = [parsed.hostname, parsed.pathname, parsed.searchParams.toString()]
      .filter(Boolean)
      .join(' ')
      .replace(/[-_\/\.]/g, ' ')
      .trim();
    return segments;
  } catch (error) {
    return String(url || '').replace(/https?:\/\//i, '').replace(/[-_\/\.]/g, ' ').trim();
  }
}

function normalizeAlertLinkText(value) {
  let text = String(value || '');

  // Preserve visible anchor text, but drop the href URL from screening.
  text = text.replace(/<a\b[^>]*>(.*?)<\/a>/gis, (_, anchorText) => anchorText || '');

  // Preserve markdown link text, but drop the target URL.
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, (_, linkText) => linkText || '');

  // Remove any remaining direct URLs entirely, since only page content should be screened.
  text = text.replace(/https?:\/\/[^\s<>"]+/gi, '');

  // Strip any remaining HTML tags.
  text = text.replace(/<[^>]+>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function getAlertTextForScreening() {
  const alertHtml = getAlertHtml();
  if (alertHtml) {
    return normalizeAlertLinkText(alertHtml);
  }

  return normalizeAlertLinkText(getAlertText());
}

function setAlertHtml(html) {
  const field = getAlertField();
  if (field) {
    field.innerHTML = html || '';
  }
}

function extractLinksFromHtml(html) {
  const links = [];
  const helper = document.createElement('div');
  helper.innerHTML = html || '';
  helper.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href');
    if (href) {
      links.push(href.trim());
    }
  });
  return links;
}

function extractLinksFromText(text) {
  const links = [];
  const pattern = /(https?:\/\/[^\s<>"']+)/gi;
  let match;
  while ((match = pattern.exec(text))) {
    links.push(match[1]);
  }
  return links;
}

function getFormData() {
  return {
    source: document.getElementById('source').value,
    link: document.getElementById('link').value,
    serialPart: document.getElementById('serialPart').value,
    alertText: getAlertText(),
    alertHtml: getAlertHtml()
  };
}

function extractAlertCriteria(formData) {
  const alertSource = getAlertTextForScreening();
  const serialNumber = String(formData.serialPart || '').trim() || extractReportField(/serial(?: number)?[:\s]*([^\n\.]+)/i, alertSource);
  const rawMake = extractReportField(/manufacturer[:\s]*([^\n\.]+)/i, alertSource);
  const rawModel = extractReportField(/model[:\s]*([^\n\.]+)/i, alertSource);
  const rawDescription = extractReportField(/(?:affected equipment|affected equipment\/system|affected system|equipment\/system|equipment|product|item)[\s:\-]*([^\n\.]+)/i, alertSource);

  return {
    serialNumber: serialNumber || '',
    make: rawMake || '',
    model: rawModel || '',
    description: rawDescription || ''
  };
}

function updateSelectionControls() {
  const hasSelection = getSelectedMatches().length > 0;
  generateReportButton.disabled = !hasSelection;
  exportPdfButton.disabled = !hasSelection || !reportOutput.innerHTML.trim();
}

function getSelectedMatches() {
  return currentMatches.filter((device) => selectedDeviceIds.has(device.id));
}

function clearSelection() {
  selectedDeviceIds.clear();
  updateSelectionControls();
}

function screenAlert(criteria) {
  const serialText = normalize(criteria.serialNumber);
  const descriptionText = normalize(criteria.description);
  const makeText = normalize(criteria.make);
  const modelText = normalize(criteria.model);

  if (!serialText && !descriptionText && !makeText && !modelText) {
    return { matches: [], scored: [] };
  }

  const scored = deviceRegistry.map((device) => {
    const reasons = [];
    const deviceDescription = normalize(device.description);
    const deviceManufacturer = normalize(device.manufacturer);
    const deviceModel = normalize(device.model);

    const descriptionMatch = descriptionText && (
      deviceDescription.includes(descriptionText) ||
      descriptionText.includes(deviceDescription)
    );
    if (descriptionMatch) {
      reasons.push('description');
    }

    const makeMatch = makeText && (
      deviceManufacturer.includes(makeText) ||
      makeText.includes(deviceManufacturer)
    );
    if (makeMatch) {
      reasons.push('make');
    }

    const modelMatch = modelText && (
      deviceModel.includes(modelText) ||
      modelText.includes(deviceModel)
    );
    if (modelMatch) {
      reasons.push('model');
    }

    const serialMatch = serialText && (
      normalize(device.id).includes(serialText) ||
      deviceModel.includes(serialText) ||
      deviceDescription.includes(serialText) ||
      deviceManufacturer.includes(serialText)
    );
    if (serialMatch) {
      reasons.push('serial no.');
    }

    const baseScore = (descriptionMatch ? 50 : 0) + (makeMatch ? 50 : 0) + (modelMatch ? 30 : 0) + (serialMatch ? 20 : 0);
    const score = baseScore;

    return {
      ...device,
      score,
      baseScore,
      matchCount: reasons.length,
      reasons: [...new Set(reasons)]
    };
  });

  const ranked = scored
    .filter((device) => device.matchCount > 1)
    .sort((a, b) => b.baseScore - a.baseScore || b.matchCount - a.matchCount || b.score - a.score)
    .slice(0, 6);

  return { matches: ranked, scored };
}

function buildTable(matches) {
  if (!matches.length) {
    return '<p>No clear matches found.</p>';
  }

  const rows = matches
    .map((device) => {
      const isSelected = selectedDeviceIds.has(device.id);
      return `
        <tr class="match-row${isSelected ? ' selected' : ''}" data-id="${escapeHtml(device.id)}" data-description="${escapeHtml(
        device.description
      )}" data-manufacturer="${escapeHtml(device.manufacturer)}" data-model="${escapeHtml(
        device.model
      )}" data-issue="${escapeHtml(device.issue)}">
          <td class="select-cell"><input type="checkbox" class="select-match" data-id="${escapeHtml(device.id)}" ${isSelected ? 'checked' : ''} aria-label="Select ${escapeHtml(device.id)}" /></td>
          <td>${escapeHtml(device.id)}</td>
          <td>${escapeHtml(device.description)}</td>
          <td>${escapeHtml(device.manufacturer)}</td>
          <td>${escapeHtml(device.model)}</td>
          <td>${escapeHtml(device.issue)}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <div class="selection-hint"><strong>Select one or more result to include in the report.</strong></div>
    <table>
      <caption class="sr-only">Relevant devices identified by screening</caption>
      <thead>
        <tr>
          <th>Select</th>
          <th>Serial No.</th>
          <th>Description</th>
          <th>Make</th>
          <th>Model</th>
          <th>Issue</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildExcelText(matches) {
  const escapeCell = (value) => String(value || '').replace(/"/g, '""').replace(/\r?\n/g, ' ');
  const header = ['Serial No.', 'Description', 'Make', 'Model', 'Issue'].map((cell) => `"${cell}"`).join(',');

  if (!matches.length) {
    return header;
  }

  const rows = matches.map((device) => [device.id, device.description, device.manufacturer, device.model, device.issue]
    .map((value) => `"${escapeCell(value)}"`)
    .join(','));

  return [header, ...rows].join('\r\n');
}

function buildExcelHtml(matches) {
  if (!matches.length) {
    return '<table><thead><tr><th>Serial No.</th><th>Description</th><th>Make</th><th>Model</th><th>Issue</th></tr></thead><tbody></tbody></table>';
  }

  const rows = matches.map((device) => `
      <tr>
        <td>${escapeHtml(device.id)}</td>
        <td>${escapeHtml(device.description)}</td>
        <td>${escapeHtml(device.manufacturer)}</td>
        <td>${escapeHtml(device.model)}</td>
        <td>${escapeHtml(device.issue)}</td>
      </tr>`).join('');

  return `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
      <style>
        table { border-collapse: collapse; }
        th, td { border: 1px solid #000; padding: 6px; }
      </style>
    </head>
    <body>
      <table>
        <thead>
          <tr>
            <th>Serial No.</th>
            <th>Description</th>
            <th>Make</th>
            <th>Model</th>
            <th>Issue</th>
          </tr>
        </thead>
        <tbody>${rows}
        </tbody>
      </table>
    </body>
    </html>`;
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function extractReportField(pattern, text) {
  const match = text.match(pattern);
  return match ? match[1].trim() : '';
}

function parseReportFields(formData) {
  const alertText = String(formData.alertText || '');
  const defaultSource = 'Medical Device Safety Alert report from department of health';
  const serialField = extractReportField(/serial(?: number)?[:\s]*([^\n\.]+)/i, alertText);

  return {
    sourceText: defaultSource,
    issuingAuthority: defaultSource,
    alertCategory: extractReportField(/alert category[:\s]*([^\n\.]+)/i, alertText) || 'N/A',
    affectedDescription: extractReportField(/(?:affected equipment|affected equipment\/system|affected system|equipment\/system|equipment|product|item)[\s:\-]*([^\n\.]+)/i, alertText) || 'N/A',
    affectedManufacturer: extractReportField(/manufacturer[:\s]*([^\n\.]+)/i, alertText) || 'N/A',
    affectedModel: extractReportField(/model[:\s]*([^\n\.]+)/i, alertText) || 'N/A',
    serialNumber: serialField || String(formData.serialPart || 'N/A'),
    descriptionOfIssue: extractReportField(/(?:issue|problem|fault|failure|malfunction|defect)[:\s]*([^\n\.]+)/i, alertText) || 'N/A',
    reportedRootCause: extractReportField(/(?:root cause|cause)[:\s]*([^\n\.]+)/i, alertText) || 'N/A'
  };
}

function generateReportForm(formData, reportFields, selectedDevices = []) {
  const sourceText = escapeHtml(reportFields.sourceText);
  const issuingAuthority = escapeHtml(reportFields.issuingAuthority);
  const alertCategory = escapeHtml(reportFields.alertCategory);
  const affectedDescription = escapeHtml(reportFields.affectedDescription);
  const affectedManufacturer = escapeHtml(reportFields.affectedManufacturer);
  const affectedModel = escapeHtml(reportFields.affectedModel);
  const serialNumber = escapeHtml(reportFields.serialNumber);
  const descriptionOfIssue = escapeHtml(reportFields.descriptionOfIssue);
  const reportedRootCause = escapeHtml(reportFields.reportedRootCause);

  return `
    <div class="report">
      <h2 class="report-title">SAFETY CASE ASSESSMENT &amp; PROGRESS REPORT</h2>
      <div class="report-row"><strong>source of information:</strong> ${sourceText}</div>
      <div class="report-row"><strong>Recieved date:</strong> ____________________</div>
      <div class="report-row"><strong>File Ref:</strong> _________________________</div>

      <br/><br/>
      ${selectedDevices.length ? `
      <div class="report-row report-label">Selected devices included in this report:</div>
      <br/>
      <table class="report-table report-selected">
        <thead>
          <tr>
            <th>Serial No.</th>
            <th>Description</th>
            <th>Make</th>
            <th>Model</th>
            <th>Issue</th>
          </tr>
        </thead>
        <tbody>
          ${selectedDevices.map((device) => `
            <tr>
              <td>${escapeHtml(device.id)}</td>
              <td>${escapeHtml(device.description)}</td>
              <td>${escapeHtml(device.manufacturer)}</td>
              <td>${escapeHtml(device.model)}</td>
              <td>${escapeHtml(device.issue)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <br/>
      ` : ''}
      <div class="report-row report-label">Details of safety information:</div>
      <br/>
      <table class="report-table">
        <tbody>
          <tr>
            <td class="part">a.</td>
            <td class="part-content">Issuing authority: ${issuingAuthority}</td>
          </tr>
          <tr>
            <td class="part">b.</td>
            <td class="part-content">Alert category: ${alertCategory}</td>
          </tr>
          <tr>
            <td class="part">c.</td>
            <td class="part-content">Affected equipment/system:
              <ul class="subpoints">
                <li>Description: ${affectedDescription}</li>
                <li>Manufacturer: ${affectedManufacturer}</li>
                <li>Make / model: ${affectedModel}</li>
                <li>Serial No. (if any): ${serialNumber}</li>
              </ul>
            </td>
          </tr>
          <tr>
            <td class="part">d.</td>
            <td class="part-content">Description of issue: ${descriptionOfIssue}</td>
          </tr>
          <tr>
            <td class="part">e.</td>
            <td class="part-content">Reported root cause: ${reportedRootCause}</td>
          </tr>
        </tbody>
      </table>

      <br/><br/>
      <div class="report-row report-underline">prepared by:</div>
      <br/>
      <div class="report-row">Name: _______________________________</div>
      <br/>
      <div class="report-row">Post: ________________________________</div>
      <br/>
      <div class="report-row">Date: ________________________________</div>

      <br/><br/>
      <div class="report-row report-highlight">Endorsed by:</div>
      <br/>
      <div class="report-row">Name: _______________________________</div>
      <br/>
      <div class="report-row">Post: ________________________________</div>
      <br/>
      <div class="report-row">Date: ________________________________</div>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderResult(result, formData) {
  const { matches } = result;
  currentMatches = matches || [];
  selectedDeviceIds.clear();
  reportOutput.innerHTML = '';

  if (!matches.length) {
    resultSummary.innerHTML = '<strong>No clear match.</strong> The alert does not appear to correspond to the current device register.';
    resultTable.innerHTML = '<p role="status">No clear matches found.</p>';
    updateSelectionControls();
    return;
  }

  const matchText = matches.length === 1 ? '1 relevant device identified.' : `${matches.length} relevant devices identified.`;
  resultSummary.innerHTML = `
    <strong>${matchText}</strong><br />
    Source: ${escapeHtml(formData.source || 'not provided')}<br />
    Screening signal: ${matches[0].reasons.join(', ')}<br />
    <div class="selection-hint">Select one or more results to enable report generation.</div>
  `;
  resultTable.innerHTML = buildTable(matches);
  updateSelectionControls();
}

resultTable.addEventListener('change', (event) => {
  if (!event.target || !event.target.matches('.select-match')) return;

  const checkbox = event.target;
  const id = checkbox.dataset.id;
  if (checkbox.checked) {
    selectedDeviceIds.add(id);
  } else {
    selectedDeviceIds.delete(id);
  }

  resultTable.innerHTML = buildTable(currentMatches);
  const selected = getSelectedMatches();
  if (selected.length) {
    resultSummary.innerHTML = `<strong>${selected.length} selected.</strong> ${selected.length > 1 ? 'Multiple devices selected for report.' : 'One device selected for report.'}`;
  } else {
    resultSummary.innerHTML = '<div class="selection-hint">Select one or more results to enable report generation.</div>';
  }
  updateSelectionControls();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const formData = getFormData();
  const alertHtmlText = getAlertTextForScreening();
  const screeningText = alertHtmlText.trim();

  if (!screeningText) {
    resultSummary.innerHTML = '<strong>Please paste an alert first.</strong>';
    resultTable.innerHTML = '';
    return;
  }

  const criteria = extractAlertCriteria({
    ...formData,
    alertText: alertHtmlText
  });

  const result = screenAlert(criteria);
  renderResult(result, formData);
});

copyButton.addEventListener('click', () => {
  const formData = getFormData();

  if (!formData.alertText.trim()) {
    resultSummary.innerHTML = '<strong>Please paste an alert first.</strong>';
    return;
  }

  const selected = getSelectedMatches();
  if (!selected.length) {
    resultSummary.innerHTML = '<strong>Please select one or more result to export to Excel.</strong>';
    return;
  }

  const html = buildExcelHtml(selected);
  downloadFile('device-screening-export.xls', html, 'application/vnd.ms-excel;charset=utf-8;');
  resultSummary.innerHTML = '<strong>Excel file downloaded.</strong> Open it in Excel to view the selected matches.';
});

exportPdfButton.addEventListener('click', () => {
  const currentReport = reportOutput.innerHTML.trim();
  const selected = getSelectedMatches();
  if (!currentReport || !selected.length) {
    resultSummary.innerHTML = '<strong>Please select one or more results and generate a report first.</strong>';
    return;
  }

  document.body.classList.add('print-report');
  window.onafterprint = () => {
    document.body.classList.remove('print-report');
    window.onafterprint = null;
  };

  setTimeout(() => {
    window.print();
  }, 120);
});

generateReportButton.addEventListener('click', () => {
  const formData = getFormData();

  const selected = getSelectedMatches();
  if (!selected.length) {
    reportOutput.innerHTML = '';
    resultSummary.innerHTML = '<strong>Please select one or more results.</strong> The report cannot be generated until at least one screening result is selected.';
    return;
  }

  const reportFields = parseReportFields(formData);
  reportOutput.innerHTML = generateReportForm(formData, reportFields, selected);
  resultSummary.innerHTML = `<strong>Report form generated.</strong> ${selected.length} result${selected.length === 1 ? '' : 's'} included in the report and PDF export.`;
  updateSelectionControls();
});

useExampleButton.addEventListener('click', () => {
  document.getElementById('source').value = 'TGA';
  document.getElementById('link').value = 'https://apps.tga.gov.au/PROD/DRAC/arn-entry.aspx';
  document.getElementById('serialPart').value = 'LCSU 4';
  setAlertHtml(`TGA Safety Alert: Laerdal airway aspirators. The service life of LCSU 4 units manufactured between 9 August 2018 and 6 June 2020 may be reduced due to weakness in the design and assembly process. The pump may malfunction resulting in low suction levels or failure to provide suction.`);
});

clearFormButton.addEventListener('click', () => {
  form.reset();
  setAlertHtml('');
  document.getElementById('source').value = '';
  reportOutput.innerHTML = '';
  currentMatches = [];
  selectedDeviceIds.clear();
  resultSummary.innerHTML = 'No screening has been run yet.';
  resultTable.innerHTML = '';
  updateSelectionControls();
});

generateReportButton.disabled = true;
exportPdfButton.disabled = true;
loadDeviceRegistry();

// Click-to-screen: clicking a match row will populate the form and re-run screening
resultTable.addEventListener('click', (e) => {
  if (e.target && e.target.closest && e.target.closest('input.select-match')) return;
  const tr = e.target.closest && e.target.closest('tr.match-row');
  if (!tr) return;
  const id = tr.dataset.id || '';
  const description = tr.dataset.description || '';

  const serialInput = document.getElementById('serialPart');
  const alertInput = document.getElementById('alertText');
  if (serialInput) serialInput.value = id;
  if (alertInput) setAlertHtml(escapeHtml(description));

  const formData = {
    source: document.getElementById('source').value,
    link: document.getElementById('link').value,
    serialPart: serialInput ? serialInput.value : id,
    alertText: getAlertText(),
    alertHtml: getAlertHtml()
  };

const criteria = extractAlertCriteria(formData);
    const result = screenAlert(criteria);
  renderResult(result, formData);
  resultSummary.innerHTML = '<strong>Screened selected device.</strong>';
});
