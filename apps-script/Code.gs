/**
 * WorkFlow Pro - Google Apps Script backend (append-only).
 *
 * Create a Google Sheet and set its ID in Script Properties:
 * - SHEET_ID = <spreadsheetId>
 *
 * Then deploy as Web App (Execute as: Me, Who has access: Anyone with the link).
 *
 * Endpoints:
 * - GET  ?action=state          -> returns {tasks, employees, vehicles, contacts, admins}
 * - GET  ?action=login&u=...&p=...  -> returns {ok:true, username} when valid
 * - POST {action:"event", event:{entity, action, payload, clientId?}} -> appends to events log
 */

var TAB_EVENTS = 'events';
var TAB_ADMINS = 'admins';
var TAB_TASKS = 'tasks';
var TAB_EMPLOYEES = 'employees';
var TAB_VEHICLES = 'vehicles';
var TAB_CONTACTS = 'contacts';

var PROP_UPDATED_AT = 'SNAPSHOT_UPDATED_AT';

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'state';
  if (action === 'state') {
    return respond_(e, buildState_());
  }
  if (action === 'login') {
    var u = (e && e.parameter && e.parameter.u) || '';
    var p = (e && e.parameter && e.parameter.p) || '';
    return respond_(e, login_(String(u), String(p)));
  }
  return respond_(e, { error: 'Unknown action' }, 400);
}

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      // Accept JSON sent as text/plain (for sendBeacon / no-cors)
      body = JSON.parse(e.postData.contents);
    }
    if (body.action !== 'event' || !body.event) {
      return respond_(null, { error: 'Invalid request' }, 400);
    }
    // Write-through: update snapshot tabs + append log event
    applyEventToSnapshot_(body.event);
    appendEvent_(body.event);
    return respond_(null, { ok: true });
  } catch (err) {
    return respond_(null, { error: String(err && err.message ? err.message : err) }, 500);
  }
}

function respond_(e, obj, code) {
  // JSONP support to bypass browser CORS
  var cb = e && e.parameter && e.parameter.callback;
  if (cb) {
    var js = cb + '(' + JSON.stringify(obj) + ');';
    var out = ContentService.createTextOutput(js);
    out.setMimeType(ContentService.MimeType.JAVASCRIPT);
    if (code) out.setResponseCode(code);
    return out;
  }
  var output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  if (code) output.setResponseCode(code);
  return output;
}

function getSheet_() {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('Missing Script Property SHEET_ID');
  return SpreadsheetApp.openById(sheetId);
}

function ensureEventsTab_() {
  var ss = getSheet_();
  var sh = ss.getSheetByName(TAB_EVENTS);
  if (!sh) sh = ss.insertSheet(TAB_EVENTS);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['ts', 'entity', 'action', 'payloadJson', 'clientId']);
  }
  return sh;
}

function ensureAdminsTab_() {
  var ss = getSheet_();
  var sh = ss.getSheetByName(TAB_ADMINS);
  if (!sh) sh = ss.insertSheet(TAB_ADMINS);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['username', 'password', 'updatedAt']);
  }
  return sh;
}

function ensureListTab_(tabName, headerName) {
  var ss = getSheet_();
  var sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);
  if (sh.getLastRow() === 0) {
    sh.appendRow([headerName || 'name', 'updatedAt']);
  }
  return sh;
}

function ensureKvJsonTab_(tabName, keyHeader) {
  var ss = getSheet_();
  var sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);
  if (sh.getLastRow() === 0) {
    sh.appendRow([keyHeader || 'id', 'json', 'updatedAt']);
  }
  return sh;
}

function appendEvent_(event) {
  var sh = ensureEventsTab_();
  var ts = new Date().toISOString();
  var entity = String(event.entity || '');
  var action = String(event.action || '');
  var payloadJson = JSON.stringify(event.payload || {});
  var clientId = event.clientId ? String(event.clientId) : '';
  sh.appendRow([ts, entity, action, payloadJson, clientId]);

  // Keep a current snapshot tab for admins (easy view/edit control)
  if (entity === 'admins') {
    syncAdminsSheet_();
  }
}

function touchUpdatedAt_() {
  try {
    PropertiesService.getScriptProperties().setProperty(PROP_UPDATED_AT, new Date().toISOString());
  } catch (e) {
    // ignore
  }
}

function applyEventToSnapshot_(event) {
  ensureAdminsTab_();
  ensureListTab_(TAB_EMPLOYEES, 'name');
  ensureListTab_(TAB_VEHICLES, 'name');
  ensureKvJsonTab_(TAB_TASKS, 'id');
  ensureKvJsonTab_(TAB_CONTACTS, 'id');

  var entity = String(event.entity || '');
  var action = String(event.action || '');
  var payload = event.payload || {};

  if (entity === 'employees') {
    if (action === 'import' && payload && payload.employees) {
      replaceListTab_(TAB_EMPLOYEES, payload.employees);
      touchUpdatedAt_();
      return;
    }
    if (action === 'upsert' && payload && payload.name) {
      upsertListTab_(TAB_EMPLOYEES, String(payload.name));
      touchUpdatedAt_();
      return;
    }
    if (action === 'delete' && payload && payload.name) {
      deleteFromListTab_(TAB_EMPLOYEES, String(payload.name));
      touchUpdatedAt_();
      return;
    }
  }

  if (entity === 'vehicles') {
    if (action === 'import' && payload && payload.vehicles) {
      replaceListTab_(TAB_VEHICLES, payload.vehicles);
      touchUpdatedAt_();
      return;
    }
    if (action === 'upsert' && payload && payload.name) {
      upsertListTab_(TAB_VEHICLES, String(payload.name));
      touchUpdatedAt_();
      return;
    }
    if (action === 'delete' && payload && payload.name) {
      deleteFromListTab_(TAB_VEHICLES, String(payload.name));
      touchUpdatedAt_();
      return;
    }
  }

  if (entity === 'admins') {
    // admins snapshot is handled by syncAdminsSheet_ from events,
    // but we also touch updatedAt for quick polling
    if (action === 'upsert' || action === 'delete' || action === 'import') touchUpdatedAt_();
    return;
  }

  if (entity === 'tasks') {
    if (action === 'import' && payload && payload.tasks) {
      replaceKvJsonTab_(TAB_TASKS, payload.tasks, 'id');
      touchUpdatedAt_();
      return;
    }
    if (action === 'upsert' && payload && payload.id) {
      upsertKvJsonTab_(TAB_TASKS, String(payload.id), payload);
      touchUpdatedAt_();
      return;
    }
    if (action === 'delete' && payload && payload.id) {
      deleteKvJsonTab_(TAB_TASKS, String(payload.id));
      touchUpdatedAt_();
      return;
    }
  }

  if (entity === 'contacts') {
    if (action === 'import' && payload && payload.contacts) {
      replaceKvJsonTab_(TAB_CONTACTS, payload.contacts, 'id');
      touchUpdatedAt_();
      return;
    }
    if (action === 'upsert' && payload && payload.id) {
      upsertKvJsonTab_(TAB_CONTACTS, String(payload.id), payload);
      touchUpdatedAt_();
      return;
    }
    if (action === 'delete' && payload && payload.id) {
      deleteKvJsonTab_(TAB_CONTACTS, String(payload.id));
      touchUpdatedAt_();
      return;
    }
  }
}

function getUpdatedAt_() {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(PROP_UPDATED_AT);
    return v || '';
  } catch (e) {
    return '';
  }
}

function readListTab_(tabName) {
  var sh = ensureListTab_(tabName, 'name');
  var values = sh.getDataRange().getValues();
  var rows = values.length > 1 ? values.slice(1) : [];
  var out = [];
  rows.forEach(function (r) {
    var name = String(r[0] || '').trim();
    if (name) out.push(name);
  });
  // stable order
  out.sort();
  return out;
}

function readKvJsonTab_(tabName) {
  var sh = ensureKvJsonTab_(tabName, 'id');
  var values = sh.getDataRange().getValues();
  var rows = values.length > 1 ? values.slice(1) : [];
  var out = [];
  rows.forEach(function (r) {
    var json = String(r[1] || '').trim();
    if (!json) return;
    try {
      out.push(JSON.parse(json));
    } catch (e) {
      // ignore bad rows
    }
  });
  return out;
}

function upsertListTab_(tabName, name) {
  var sh = ensureListTab_(tabName, 'name');
  var values = sh.getDataRange().getValues();
  var rows = values.length > 1 ? values.slice(1) : [];
  var now = new Date().toISOString();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || '') === name) {
      sh.getRange(i + 2, 2).setValue(now);
      return;
    }
  }
  sh.appendRow([name, now]);
}

function deleteFromListTab_(tabName, name) {
  var sh = ensureListTab_(tabName, 'name');
  var values = sh.getDataRange().getValues();
  var rows = values.length > 1 ? values.slice(1) : [];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || '') === name) {
      sh.deleteRow(i + 2);
      return;
    }
  }
}

function replaceListTab_(tabName, list) {
  var sh = ensureListTab_(tabName, 'name');
  var now = new Date().toISOString();
  var rows = (list || [])
    .map(function (x) {
      var name = String(x || '').trim();
      return name ? [name, now] : null;
    })
    .filter(function (x) {
      return x;
    });
  // Clear old rows (keep header)
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 2).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
}

function upsertKvJsonTab_(tabName, id, obj) {
  var sh = ensureKvJsonTab_(tabName, 'id');
  var values = sh.getDataRange().getValues();
  var rows = values.length > 1 ? values.slice(1) : [];
  var now = new Date().toISOString();
  var json = JSON.stringify(obj || {});
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || '') === id) {
      sh.getRange(i + 2, 2).setValue(json);
      sh.getRange(i + 2, 3).setValue(now);
      return;
    }
  }
  sh.appendRow([id, json, now]);
}

function deleteKvJsonTab_(tabName, id) {
  var sh = ensureKvJsonTab_(tabName, 'id');
  var values = sh.getDataRange().getValues();
  var rows = values.length > 1 ? values.slice(1) : [];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || '') === id) {
      sh.deleteRow(i + 2);
      return;
    }
  }
}

function replaceKvJsonTab_(tabName, items, idKey) {
  var sh = ensureKvJsonTab_(tabName, 'id');
  var now = new Date().toISOString();
  var rows = (items || [])
    .map(function (x) {
      if (!x) return null;
      var id = x[idKey || 'id'];
      if (!id) return null;
      return [String(id), JSON.stringify(x), now];
    })
    .filter(function (x) {
      return x;
    });
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows);
}

function getAdminsMapFromEvents_() {
  var sh = ensureEventsTab_();
  var values = sh.getDataRange().getValues();
  var rows = values.length > 1 ? values.slice(1) : [];
  var adminsByUser = { admin: { username: 'admin', password: 'admin' } };
  rows.forEach(function (r) {
    var entity = String(r[1] || '');
    var action = String(r[2] || '');
    if (entity !== 'admins') return;
    var payload = {};
    try {
      payload = JSON.parse(String(r[3] || '{}'));
    } catch (e) {
      payload = {};
    }
    if (action === 'upsert' && payload && payload.username && payload.password) {
      adminsByUser[String(payload.username)] = {
        username: String(payload.username),
        password: String(payload.password),
      };
    }
    if (action === 'delete' && payload && payload.username) {
      var key = String(payload.username);
      if (key !== 'admin') delete adminsByUser[key];
    }
  });
  return adminsByUser;
}

function syncAdminsSheet_() {
  var sh = ensureAdminsTab_();
  var adminsByUser = getAdminsMapFromEvents_();
  var keys = Object.keys(adminsByUser).sort();
  var now = new Date().toISOString();
  var rows = keys.map(function (u) {
    return [adminsByUser[u].username, adminsByUser[u].password, now];
  });

  // Clear old rows (keep header)
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows);
}

function buildState_() {
  // Snapshot-first: hard 2-way sync (sheet is source of truth)
  // Ensure tabs exist
  ensureAdminsTab_();
  ensureListTab_(TAB_EMPLOYEES, 'name');
  ensureListTab_(TAB_VEHICLES, 'name');
  ensureKvJsonTab_(TAB_TASKS, 'id');
  ensureKvJsonTab_(TAB_CONTACTS, 'id');

  // Keep admins snapshot in sync with events (so admins still managed append-only)
  try {
    syncAdminsSheet_();
  } catch (e) {
    // ignore
  }

  var state = {
    tasks: readKvJsonTab_(TAB_TASKS),
    employees: readListTab_(TAB_EMPLOYEES),
    vehicles: readListTab_(TAB_VEHICLES),
    contacts: readKvJsonTab_(TAB_CONTACTS),
    admins: Object.keys(getAdminsMapFromEvents_()),
    updatedAt: getUpdatedAt_(),
  };
  return state;
}

function login_(username, password) {
  username = String(username || '').trim();
  password = String(password || '');
  if (!username || !password) return { ok: false };

  var adminsByUser = getAdminsMapFromEvents_();

  var found = adminsByUser[username];
  if (found && String(found.password) === password) return { ok: true, username: username };
  return { ok: false };
}

