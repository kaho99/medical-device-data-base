const form = document.getElementById('screeningForm');
const resultSummary = document.getElementById('resultSummary');
const resultTable = document.getElementById('resultTable');
const databaseList = document.getElementById('databaseList');
const copyButton = document.getElementById('copyTable');
const generateReportButton = document.getElementById('generateReport');
const exportPdfButton = document.getElementById('exportPdf');
const useExampleButton = document.getElementById('useExample');
const clearFormButton = document.getElementById('clearForm');

let deviceRegistry = [];

if (!form || !resultSummary || !resultTable || !databaseList || !copyButton || !generateReportButton || !exportPdfButton || !useExampleButton || !clearFormButton) {
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
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalize(value)
    .split(/\s+/)
    .filter(Boolean);
}

function getMeaningfulTokens(value) {
  const stopWords = new Set([
    'the', 'and', 'or', 'for', 'with', 'this', 'that', 'from', 'into', 'during', 'after',
    'before', 'may', 'can', 'will', 'due', 'been', 'were', 'was', 'are', 'is', 'be', 'of',
    'to', 'in', 'on', 'a', 'an', 'as', 'at', 'by', 'it', 'its', 'their', 'our', 'your',
    'device', 'devices', 'alert', 'safety', 'medical', 'related', 'situation', 'issue', 'noted',
    'units', 'unit', 'manufactured', 'manufacture', 'manufacturing', 'service', 'life', 'pump',
    'resulting', 'failure', 'provide', 'levels', 'low', 'high', 'part', 'parts'
  ]);

  return tokenize(value).filter((token) => token.length > 2 && !stopWords.has(token));
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

function screenAlert(alertText, source, link, serialPart) {
  const queryParts = [alertText, source, link, serialPart].filter((value) => String(value || '').trim());
  const query = normalize(queryParts.join(' '));
  const alertMeaningfulTokens = new Set(getMeaningfulTokens(query));
  const serialText = normalize(serialPart);

  if (!alertMeaningfulTokens.size) {
    return { matches: [], scored: [] };
  }

  const candidateDevices = deviceRegistry.filter((device) => {
    if (!device.searchTokens?.length) {
      return false;
    }
    return device.searchTokens.some((token) => alertMeaningfulTokens.has(token));
  });

  const scored = candidateDevices.map((device) => {
    const reasons = [];
    let score = 0;

    const descriptionText = normalize(device.description);
    const modelText = normalize(device.model);
    const objectTypeText = normalize(device.objectType);

    const descriptionScore = overlapScore(query, descriptionText);
    if (descriptionScore >= 0.4 || query.includes(descriptionText)) {
      score += 10;
      reasons.push('description');
    }

    const manufacturerTokens = tokenize(device.manufacturer);
    const manufacturerMatch = manufacturerTokens.some((token) => alertMeaningfulTokens.has(token));
    if (manufacturerMatch) {
      score += 8;
      reasons.push('manufacturer');
    }

    const modelTokens = tokenize(device.model);
    const modelMatch = modelTokens.some((token) => alertMeaningfulTokens.has(token));
    if (modelMatch) {
      score += 8;
      reasons.push('model');
    }

    if (serialText && (modelText.includes(serialText) || descriptionText.includes(serialText))) {
      score += 6;
      reasons.push('serial/part');
    }

    if (objectTypeText && alertMeaningfulTokens.has(normalize(objectTypeText))) {
      score += 3;
      reasons.push('object type');
    }

    const keywordMatches = device.keywords.filter((keyword) => alertMeaningfulTokens.has(normalize(keyword))).length;
    if (keywordMatches) {
      score += keywordMatches;
    }

    const sharedTokenCount = device.searchTokens.filter((token) => alertMeaningfulTokens.has(token)).length;
    if (sharedTokenCount) {
      score += sharedTokenCount;
      reasons.push('keyword overlap');
    }

    return { ...device, score, reasons: [...new Set(reasons)] };
  });

  const ranked = scored
    .filter((device) => device.score >= 12 && device.reasons.length >= 2)
    .sort((a, b) => b.score - a.score || b.reasons.length - a.reasons.length)
    .slice(0, 6);

  return { matches: ranked, scored };
}

function buildTable(matches) {
  if (!matches.length) {
    return '<p>No clear matches found.</p>';
  }

  const rows = matches
    .map(
      (device) => `
        <tr>
          <td>${escapeHtml(device.id)}</td>
          <td>${escapeHtml(device.description)}</td>
          <td>${escapeHtml(device.manufacturer)}</td>
          <td>${escapeHtml(device.model)}</td>
          <td>${escapeHtml(device.issue)}</td>
        </tr>
      `
    )
    .join('');

  return `
    <table>
      <caption class="sr-only">Relevant devices identified by screening</caption>
      <thead>
        <tr>
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

function downloadCsv(filename, content) {
  const blob = new Blob(["\uFEFF" + content], { type: 'text/csv;charset=utf-8;' });
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

  return {
    sourceText: defaultSource,
    issuingAuthority: defaultSource,
    alertCategory: extractReportField(/alert category[:\s]*([^\n\.]+)/i, alertText) || 'Not specified',
    affectedDescription: extractReportField(/(?:affected equipment|affected equipment\/system|affected system|equipment\/system|equipment)[\s:\-]*([^\n\.]+)/i, alertText) || 'Not specified',
    affectedManufacturer: extractReportField(/manufacturer[:\s]*([^\n\.]+)/i, alertText) || 'Not specified',
    affectedModel: extractReportField(/model[:\s]*([^\n\.]+)/i, alertText) || 'Not specified',
    serialNumber: extractReportField(/serial(?: number)?[:\s]*([^\n\.]+)/i, alertText) || String(formData.serialPart || 'Not specified'),
    descriptionOfIssue: extractReportField(/(?:issue|problem|fault|failure|malfunction|defect)[:\s]*([^\n\.]+)/i, alertText) || 'Not specified',
    reportedRootCause: extractReportField(/(?:root cause|cause)[:\s]*([^\n\.]+)/i, alertText) || 'Not specified'
  };
}

function generateReportForm(formData, reportFields, matchHtml) {
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
      <div class="report-row report-label">Relevant device matches:</div>
      ${matchHtml}

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

  if (!matches.length) {
    resultSummary.innerHTML = '<strong>No clear match.</strong> The alert does not appear to correspond to the current device register.';
    resultTable.innerHTML = '<p role="status">No clear matches found.</p>';
    return;
  }

  const matchText = matches.length === 1 ? '1 relevant device identified.' : `${matches.length} relevant devices identified.`;
  resultSummary.innerHTML = `
    <strong>${matchText}</strong><br />
    Source: ${escapeHtml(formData.source || 'not provided')}<br />
    Screening signal: ${matches[0].reasons.join(', ')}
  `;
  resultTable.innerHTML = buildTable(matches);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const formData = {
    source: document.getElementById('source').value,
    link: document.getElementById('link').value,
    serialPart: document.getElementById('serialPart').value,
    alertText: document.getElementById('alertText').value
  };

  if (!formData.alertText.trim()) {
    resultSummary.innerHTML = '<strong>Please paste an alert first.</strong>';
    resultTable.innerHTML = '';
    return;
  }

  const result = screenAlert(formData.alertText, formData.source, formData.link, formData.serialPart);
  renderResult(result, formData);
});

copyButton.addEventListener('click', () => {
  const formData = {
    source: document.getElementById('source').value,
    link: document.getElementById('link').value,
    serialPart: document.getElementById('serialPart').value,
    alertText: document.getElementById('alertText').value
  };

  if (!formData.alertText.trim()) {
    resultSummary.innerHTML = '<strong>Please paste an alert first.</strong>';
    return;
  }

  const result = screenAlert(formData.alertText, formData.source, formData.link, formData.serialPart);

  if (!result.matches.length) {
    resultSummary.innerHTML = '<strong>No relevant devices found.</strong> Nothing to export.';
    return;
  }

  const csv = buildExcelText(result.matches);
  downloadCsv('device-screening-export.csv', csv);
  resultSummary.innerHTML = '<strong>Excel file downloaded.</strong> Open it in Excel to view the matching table.';
});

exportPdfButton.addEventListener('click', () => {
  const currentReport = resultTable.innerHTML.trim();
  if (!currentReport) {
    resultSummary.innerHTML = '<strong>Please generate a report first.</strong>';
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
  const formData = {
    source: document.getElementById('source').value,
    link: document.getElementById('link').value,
    serialPart: document.getElementById('serialPart').value,
    alertText: document.getElementById('alertText').value
  };

  const reportFields = parseReportFields(formData);
  const result = screenAlert(formData.alertText, reportFields.sourceText, formData.link, formData.serialPart);
  const matchHtml = buildTable(result.matches);
  resultTable.innerHTML = generateReportForm(formData, reportFields, matchHtml);
  resultSummary.innerHTML = '<strong>Report form generated.</strong> Use Export as PDF to print the visible report.';
});

useExampleButton.addEventListener('click', () => {
  document.getElementById('source').value = 'TGA';
  document.getElementById('link').value = 'https://apps.tga.gov.au/PROD/DRAC/arn-entry.aspx';
  document.getElementById('serialPart').value = 'LCSU 4';
  document.getElementById('alertText').value = `TGA Safety Alert: Laerdal airway aspirators. The service life of LCSU 4 units manufactured between 9 August 2018 and 6 June 2020 may be reduced due to weakness in the design and assembly process. The pump may malfunction resulting in low suction levels or failure to provide suction.`;
});

clearFormButton.addEventListener('click', () => {
  form.reset();
  document.getElementById('source').value = '';
  resultSummary.innerHTML = 'No screening has been run yet.';
  resultTable.innerHTML = '';
});

loadDeviceRegistry();
