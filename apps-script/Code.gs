/**
 * FormPing WhatsApp: Google Forms editor add-on (Apps Script, V8).
 *
 * Developer setup (once, in the Apps Script project, NOT visible to users):
 *   Project Settings -> Script Properties:
 *     FORMPING_API_BASE    https://formping-whatsapp.vercel.app
 *     FORMPING_API_SECRET  same value as FORMPING_API_SECRET on Vercel
 *
 * Per-form user settings live in Document Properties (scoped to the form).
 */

var CONFIG_KEY = 'formping_config';
var LAST_RUN_KEY = 'formping_last_run';
var TRIGGER_HANDLER = 'onFormSubmit';

var DEFAULT_CONFIG = {
  active: false,
  ownerPhone: '',
  defaultCountryCode: '91',
  ownerMessage: '{{All Answers}}',
  customerEnabled: false,
  customerPhoneQuestion: '',
  customerName: '',
  customerMessage: 'We received your response and will get back to you shortly.'
};

// -----------------------------------------------------------------------------
// Menu + sidebar
// -----------------------------------------------------------------------------

function onOpen(e) {
  FormApp.getUi()
    .createAddonMenu()
    .addItem('Open FormPing', 'showSidebar')
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

function showSidebar() {
  var html = HtmlService.createTemplateFromFile('Sidebar')
    .evaluate()
    .setTitle('FormPing WhatsApp');
  FormApp.getUi().showSidebar(html);
}

// -----------------------------------------------------------------------------
// Called from Sidebar.html via google.script.run
// -----------------------------------------------------------------------------

/** Everything the sidebar needs in one round trip. */
function getSidebarData() {
  var form = FormApp.getActiveForm();
  var config = getConfig_();
  var status = null;
  var statusError = null;
  try {
    status = fetchStatus_();
  } catch (err) {
    statusError = String(err.message || err);
  }
  return {
    email: currentEmail_(),
    formTitle: form.getTitle() || 'Untitled form',
    questions: getQuestions_(form),
    config: config,
    triggerActive: hasTrigger_(form),
    status: status,
    statusError: statusError,
    lastRun: JSON.parse(PropertiesService.getDocumentProperties().getProperty(LAST_RUN_KEY) || 'null')
  };
}

function saveSettings(input) {
  var current = getConfig_();
  var next = {
    active: current.active,
    ownerPhone: clean_(input.ownerPhone, 32),
    defaultCountryCode: clean_(input.defaultCountryCode, 4).replace(/\D/g, ''),
    ownerMessage: clean_(input.ownerMessage, 900),
    customerEnabled: !!input.customerEnabled,
    customerPhoneQuestion: clean_(input.customerPhoneQuestion, 300),
    customerName: clean_(input.customerName, 200),
    customerMessage: clean_(input.customerMessage, 600)
  };

  if (next.ownerPhone && !looksLikePhone_(next.ownerPhone)) {
    throw new Error('Owner WhatsApp number looks invalid. Use the full number with country code, e.g. +919876543210.');
  }
  if (next.customerEnabled && !next.customerPhoneQuestion) {
    throw new Error('Choose which question holds the customer\'s phone number.');
  }
  if (next.customerEnabled) {
    var status = fetchStatus_();
    if (status.plan !== 'pro') {
      next.customerEnabled = false;
      throw new Error('Customer auto-reply is a Pro feature. Upgrade to turn it on.');
    }
  }

  PropertiesService.getDocumentProperties().setProperty(CONFIG_KEY, JSON.stringify(next));
  return next;
}

/** Active = installable onFormSubmit trigger exists for this form + user. */
function setActive(active) {
  var form = FormApp.getActiveForm();
  var config = getConfig_();
  if (active && !config.ownerPhone) {
    throw new Error('Add your WhatsApp number and save before activating.');
  }

  removeTriggers_(form);
  if (active) {
    ScriptApp.newTrigger(TRIGGER_HANDLER).forForm(form).onFormSubmit().create();
  }
  config.active = !!active;
  PropertiesService.getDocumentProperties().setProperty(CONFIG_KEY, JSON.stringify(config));
  return { active: hasTrigger_(form) };
}

/** Sends the owner template with sample values. Counts toward quota. */
function sendTestMessage() {
  var form = FormApp.getActiveForm();
  var config = getConfig_();
  if (!config.ownerPhone) throw new Error('Add your WhatsApp number and save first.');

  var sample = {};
  getQuestions_(form).forEach(function (q) {
    sample[q.title.toLowerCase()] = '[' + q.title + ']';
  });
  sample['form title'] = form.getTitle() || 'Untitled form';
  sample['all answers'] = 'Test message from FormPing. Your real answers appear here.';
  sample['timestamp'] = new Date().toISOString();
  sample['respondent email'] = '[Respondent Email]';

  var res = sendWhatsApp_({
    kind: 'test',
    to: config.ownerPhone,
    default_country_code: config.defaultCountryCode,
    params: [sample['form title'], render_(config.ownerMessage || DEFAULT_CONFIG.ownerMessage, sample)]
  });
  return res;
}

function getStatusForSidebar() {
  return fetchStatus_();
}

/** Returns a Razorpay hosted checkout URL for the current user. */
function createCheckout(currency) {
  if (currency !== 'USD' && currency !== 'INR') throw new Error('Unsupported currency.');
  var res = callApi_('post', '/api/create-checkout', { email: currentEmail_(), currency: currency });
  return res.url;
}

// -----------------------------------------------------------------------------
// Installable trigger handler
// -----------------------------------------------------------------------------

/**
 * Installable "On form submit" trigger (created by setActive).
 * e.source = Form, e.response = FormResponse.
 */
function onFormSubmit(e) {
  var props = PropertiesService.getDocumentProperties();
  var config = getConfig_();
  var log = { at: new Date().toISOString(), owner: null, customer: null };

  if (!config.active || !config.ownerPhone || !e || !e.response) return;

  var form = e.source || FormApp.getActiveForm();
  var vars = buildVariables_(form, e.response);
  var formTitle = vars['form title'];

  // 1. Owner notification.
  try {
    sendWhatsApp_({
      kind: 'owner',
      to: config.ownerPhone,
      default_country_code: config.defaultCountryCode,
      params: [formTitle, render_(config.ownerMessage || DEFAULT_CONFIG.ownerMessage, vars)]
    });
    log.owner = 'sent';
  } catch (err) {
    log.owner = 'failed: ' + (err.message || err);
    console.error('FormPing owner send failed', err);
  }

  // 2. Optional customer auto-reply (Pro; enforced again on the server).
  if (config.customerEnabled && config.customerPhoneQuestion) {
    var phone = vars[config.customerPhoneQuestion.toLowerCase()];
    if (phone) {
      try {
        sendWhatsApp_({
          kind: 'customer',
          to: phone,
          default_country_code: config.defaultCountryCode,
          params: [
            render_(config.customerName || 'there', vars) || 'there',
            formTitle,
            render_(config.customerMessage || DEFAULT_CONFIG.customerMessage, vars)
          ]
        });
        log.customer = 'sent';
      } catch (err2) {
        log.customer = 'failed: ' + (err2.message || err2);
        console.error('FormPing customer send failed', err2);
      }
    } else {
      log.customer = 'skipped: no phone in answer';
    }
  }

  props.setProperty(LAST_RUN_KEY, JSON.stringify(log));
}

// -----------------------------------------------------------------------------
// Variables
// -----------------------------------------------------------------------------

/** Map of lower-cased variable name -> answer text. */
function buildVariables_(form, response) {
  var vars = {};
  var all = [];
  response.getItemResponses().forEach(function (ir) {
    var title = (ir.getItem().getTitle() || '').trim();
    var value = formatAnswer_(ir.getResponse());
    if (!title) return;
    vars[title.toLowerCase()] = value;
    if (value !== '') all.push(title + ': ' + value);
  });
  vars['form title'] = form.getTitle() || 'Untitled form';
  vars['all answers'] = all.join(' | ');
  vars['timestamp'] = Utilities.formatDate(
    response.getTimestamp(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  var respondent = '';
  try { respondent = response.getRespondentEmail() || ''; } catch (ignore) {}
  vars['respondent email'] = respondent;
  return vars;
}

function formatAnswer_(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map(function (v) {
      return Array.isArray(v) ? v.filter(Boolean).join(', ') : v;
    }).filter(function (v) { return v !== null && v !== ''; }).join('; ');
  }
  return String(value).trim();
}

/** Replaces {{Question Title}} (case-insensitive) with the answer. */
function render_(template, vars) {
  return String(template || '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, function (_, name) {
    var key = name.toLowerCase();
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : '';
  }).trim();
}

// -----------------------------------------------------------------------------
// Backend calls
// -----------------------------------------------------------------------------

function sendWhatsApp_(payload) {
  payload.user_email = currentEmail_();
  try {
    return callApi_('post', '/api/send-whatsapp', payload);
  } catch (err) {
    // One retry for transient Meta/network failures.
    if (err.retryable) {
      Utilities.sleep(2000);
      return callApi_('post', '/api/send-whatsapp', payload);
    }
    throw err;
  }
}

function fetchStatus_() {
  return callApi_('get', '/api/user-status?email=' + encodeURIComponent(currentEmail_()));
}

function callApi_(method, path, body) {
  var sp = PropertiesService.getScriptProperties();
  var base = (sp.getProperty('FORMPING_API_BASE') || 'https://formping-whatsapp.vercel.app').replace(/\/+$/, '');
  var secret = sp.getProperty('FORMPING_API_SECRET');
  if (!secret) throw new Error('FormPing is not configured (missing API secret).');

  var options = {
    method: method,
    muteHttpExceptions: true,
    contentType: 'application/json',
    headers: {
      'x-formping-secret': secret,
      'x-formping-google-token': ScriptApp.getOAuthToken()
    }
  };
  if (body && method !== 'get') options.payload = JSON.stringify(body);

  var res = UrlFetchApp.fetch(base + path, options);
  var code = res.getResponseCode();
  var data;
  try { data = JSON.parse(res.getContentText()); } catch (e) { data = {}; }

  if (code >= 200 && code < 300 && data.ok !== false) return data;

  var msg = (data.error && data.error.message) || ('FormPing server error (HTTP ' + code + ')');
  var error = new Error(msg);
  error.code = data.error && data.error.code;
  error.retryable = !!data.retryable || code >= 500;
  throw error;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function getConfig_() {
  var raw = PropertiesService.getDocumentProperties().getProperty(CONFIG_KEY);
  var saved = raw ? JSON.parse(raw) : {};
  var merged = {};
  Object.keys(DEFAULT_CONFIG).forEach(function (k) {
    merged[k] = Object.prototype.hasOwnProperty.call(saved, k) ? saved[k] : DEFAULT_CONFIG[k];
  });
  return merged;
}

function getQuestions_(form) {
  var skip = [FormApp.ItemType.SECTION_HEADER, FormApp.ItemType.PAGE_BREAK,
              FormApp.ItemType.IMAGE, FormApp.ItemType.VIDEO];
  return form.getItems()
    .filter(function (item) { return skip.indexOf(item.getType()) === -1 && item.getTitle(); })
    .map(function (item) {
      return { title: item.getTitle().trim(), type: String(item.getType()) };
    });
}

function hasTrigger_(form) {
  var id = form.getId();
  return ScriptApp.getUserTriggers(form).some(function (t) {
    return t.getHandlerFunction() === TRIGGER_HANDLER && t.getTriggerSourceId() === id;
  });
}

function removeTriggers_(form) {
  ScriptApp.getUserTriggers(form).forEach(function (t) {
    if (t.getHandlerFunction() === TRIGGER_HANDLER) ScriptApp.deleteTrigger(t);
  });
}

function currentEmail_() {
  var email = Session.getEffectiveUser().getEmail();
  if (!email) throw new Error('Could not read your Google account email. Please re-authorize FormPing.');
  return email.toLowerCase();
}

function looksLikePhone_(value) {
  var digits = String(value).replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

function clean_(value, max) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
}
