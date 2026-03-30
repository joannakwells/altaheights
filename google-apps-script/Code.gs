const SHEET_ID = '1RwYs1tvGJf0J-roRhdMVnpUa1PdD6MZOvmpjsfTU8Qs';
const MIN_SUBMIT_DELAY_MS = 3000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function doGet(e) {
  return handleSignup(e);
}

function doPost(e) {
  return handleSignup(e);
}

function handleSignup(e) {
  try {
    const params = (e && e.parameter) || {};
    const name = String(params.name || '').trim();
    const email = String(params.email || '').trim();
    const company = String(params.company || '').trim();
    const callback = String(params.callback || '').trim();
    const loadedAt = Number(params.form_loaded_at || 0);
    const elapsedMs = Date.now() - loadedAt;

    if (company) {
      return responseFor({ success: true, message: 'Thanks, you are on the list.' }, callback);
    }

    if (!email) {
      return responseFor({ success: false, message: 'Email address is required.' }, callback);
    }

    if (!EMAIL_REGEX.test(email)) {
      return responseFor({ success: false, message: 'Enter a valid email address.' }, callback);
    }

    if (!loadedAt || elapsedMs < MIN_SUBMIT_DELAY_MS) {
      return responseFor({ success: false, message: 'Please wait a moment and try again.' }, callback);
    }

    const sheet = getSignupSheet();
    ensureHeaders(sheet);

    if (isDuplicateEmail(sheet, email)) {
      return responseFor({ success: true, message: 'That email is already subscribed.' }, callback);
    }

    sheet.appendRow([new Date(), name, email]);

    return responseFor({ success: true, message: 'Thanks, you are on the list.' }, callback);
  } catch (error) {
    return responseFor({ success: false, message: String(error && error.message ? error.message : error) });
  }
}

function getSignupSheet() {
  const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
  const firstSheet = spreadsheet.getSheets()[0];

  if (!firstSheet) {
    throw new Error('No sheets found in the target spreadsheet.');
  }

  return firstSheet;
}

function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'Name', 'Email']);
    return;
  }

  const headerRange = sheet.getRange(1, 1, 1, 3).getValues()[0];
  const normalizedHeaders = headerRange.map((value) => String(value || '').trim().toLowerCase());

  if (
    normalizedHeaders[0] !== 'timestamp' ||
    normalizedHeaders[1] !== 'name' ||
    normalizedHeaders[2] !== 'email'
  ) {
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, 3).setValues([['Timestamp', 'Name', 'Email']]);
  }
}

function isDuplicateEmail(sheet, email) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return false;
  }

  const values = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
  return values.some(([existingEmail]) => String(existingEmail || '').trim().toLowerCase() === email.toLowerCase());
}

function responseFor(payload, callback) {
  if (callback) {
    return jsonpResponse(payload, callback);
  }

  return jsonResponse(payload);
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonpResponse(payload, callback) {
  const safeCallback = callback.replace(/[^\w$.]/g, '');
  return ContentService
    .createTextOutput(`${safeCallback}(${JSON.stringify(payload)})`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
