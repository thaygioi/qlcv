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
  var sh = ensureEventsTab_();
  var values = sh.getDataRange().getValues();
  if (values.length <= 1) {
    // Ensure snapshot tab exists
    ensureAdminsTab_();
    // Keep admins snapshot in sync even when empty
    syncAdminsSheet_();
    return { tasks: [], employees: [], vehicles: [], contacts: [], admins: ['admin'] };
  }
  var rows = values.slice(1);

  var tasksById = {};
  var employees = {};
  var vehicles = {};
  var contactsById = {};
  var adminsByUser = { admin: { username: 'admin', password: 'admin' } };

  rows.forEach(function (r) {
    var entity = String(r[1] || '');
    var action = String(r[2] || '');
    var payload = {};
    try {
      payload = JSON.parse(String(r[3] || '{}'));
    } catch (e) {
      payload = {};
    }

    if (entity === 'tasks') {
      if (action === 'upsert' && payload && payload.id) tasksById[String(payload.id)] = payload;
      if (action === 'delete' && payload && payload.id) delete tasksById[String(payload.id)];
      if (action === 'import' && payload && payload.tasks) {
        tasksById = {};
        payload.tasks.forEach(function (t) {
          if (t && t.id) tasksById[String(t.id)] = t;
        });
      }
    }

    if (entity === 'employees') {
      if (action === 'upsert' && payload && payload.name) employees[String(payload.name)] = true;
      if (action === 'delete' && payload && payload.name) delete employees[String(payload.name)];
      if (action === 'import' && payload && payload.employees) {
        employees = {};
        payload.employees.forEach(function (name) {
          if (name) employees[String(name)] = true;
        });
      }
    }

    if (entity === 'vehicles') {
      if (action === 'upsert' && payload && payload.name) vehicles[String(payload.name)] = true;
      if (action === 'delete' && payload && payload.name) delete vehicles[String(payload.name)];
      if (action === 'import' && payload && payload.vehicles) {
        vehicles = {};
        payload.vehicles.forEach(function (name) {
          if (name) vehicles[String(name)] = true;
        });
      }
    }

    if (entity === 'contacts') {
      if (action === 'upsert' && payload && payload.id) contactsById[String(payload.id)] = payload;
      if (action === 'delete' && payload && payload.id) delete contactsById[String(payload.id)];
      if (action === 'import' && payload && payload.contacts) {
        contactsById = {};
        payload.contacts.forEach(function (c) {
          if (c && c.id) contactsById[String(c.id)] = c;
        });
      }
    }

    if (entity === 'admins') {
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
    }

    if (entity === 'bootstrap' && action === 'import' && payload) {
      // Optional: import full state
      if (payload.tasks) {
        tasksById = {};
        payload.tasks.forEach(function (t) {
          if (t && t.id) tasksById[String(t.id)] = t;
        });
      }
      if (payload.employees) {
        employees = {};
        payload.employees.forEach(function (name) {
          if (name) employees[String(name)] = true;
        });
      }
      if (payload.vehicles) {
        vehicles = {};
        payload.vehicles.forEach(function (name) {
          if (name) vehicles[String(name)] = true;
        });
      }
      if (payload.contacts) {
        contactsById = {};
        payload.contacts.forEach(function (c) {
          if (c && c.id) contactsById[String(c.id)] = c;
        });
      }
    }
  });

  // Always refresh snapshot tab on every state build
  // (ensures the `admins` sheet exists and is up to date)
  try {
    syncAdminsSheet_();
  } catch (e) {
    // ignore snapshot errors; state still works from events
  }

  return {
    tasks: Object.keys(tasksById).map(function (k) {
      return tasksById[k];
    }),
    employees: Object.keys(employees),
    vehicles: Object.keys(vehicles),
    contacts: Object.keys(contactsById).map(function (k) {
      return contactsById[k];
    }),
    admins: Object.keys(adminsByUser),
  };
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

