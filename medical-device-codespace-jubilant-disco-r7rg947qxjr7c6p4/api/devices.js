const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;
const rootDir = path.join(__dirname, '..');
const localDevicesPath = path.join(rootDir, 'devices.json');
const mddUrl = 'https://mdis.mdd.gov.hk/aps/GetMdList.php';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.static(rootDir));

function fetchMddDeviceData() {
  return new Promise((resolve, reject) => {
    const request = https.get(mddUrl, { rejectUnauthorized: false, headers: { Accept: 'application/json' } }, (apiRes) => {
      let data = '';
      apiRes.on('data', (chunk) => {
        data += chunk;
      });
      apiRes.on('end', () => {
        try {
          const payload = JSON.parse(data);
          if (payload && Array.isArray(payload.records)) {
            resolve(payload);
            return;
          }
          reject(new Error('The MDD response did not contain a valid records array.'));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.setTimeout(15000, () => {
      request.destroy(new Error('Timed out while fetching the MDD device data.'));
    });

    request.on('error', (error) => {
      reject(error);
    });
  });
}

function readLocalDeviceData() {
  if (!fs.existsSync(localDevicesPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(localDevicesPath, 'utf8'));
  } catch (error) {
    console.error('Failed to read local device data:', error.message);
    return null;
  }
}

app.get('/api/devices', async (req, res) => {
  try {
    const payload = await fetchMddDeviceData();
    fs.writeFileSync(localDevicesPath, JSON.stringify(payload, null, 2));
    res.setHeader('Content-Type', 'application/json');
    return res.json(payload);
  } catch (error) {
    console.warn('Falling back to local device snapshot:', error.message);
    const fallbackPayload = readLocalDeviceData();
    if (fallbackPayload) {
      res.setHeader('Content-Type', 'application/json');
      return res.json(fallbackPayload);
    }

    res.status(500).json({ error: 'Unable to load the current MDD device data.' });
  }
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.sendStatus(404);
  }
  res.sendFile(path.join(rootDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Device portal listening on http://localhost:${port}`);
  console.log(`Device API available at http://localhost:${port}/api/devices`);
});
