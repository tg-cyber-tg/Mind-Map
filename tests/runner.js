/*
 * Mini framework di test senza dipendenze.
 * Uso: describe('gruppo', function () { it('caso', function () { assert.equal(1, 1); }); });
 * Al termine scrive il riepilogo nella pagina (#risultati), in document.title
 * ("PASS n/n" o "FAIL k/n") e nell'attributo data-status di <body>.
 */
(function (root) {
  'use strict';

  var tests = [];
  var currentGroup = '';

  function describe(name, fn) {
    var previous = currentGroup;
    currentGroup = previous ? previous + ' › ' + name : name;
    fn();
    currentGroup = previous;
  }

  function it(name, fn) {
    tests.push({ group: currentGroup, name: name, fn: fn });
  }

  function fmt(v) {
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }

  function AssertionError(message) {
    this.name = 'AssertionError';
    this.message = message;
  }
  AssertionError.prototype = Object.create(Error.prototype);

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    var ka = Object.keys(a);
    var kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(function (k) { return Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]); });
  }

  var assert = {
    ok: function (value, message) {
      if (!value) throw new AssertionError(message || 'Atteso un valore vero, ottenuto ' + fmt(value));
    },
    equal: function (actual, expected, message) {
      if (actual !== expected) {
        throw new AssertionError((message ? message + ': ' : '') + 'atteso ' + fmt(expected) + ', ottenuto ' + fmt(actual));
      }
    },
    notEqual: function (actual, expected, message) {
      if (actual === expected) throw new AssertionError((message ? message + ': ' : '') + 'valori uguali: ' + fmt(actual));
    },
    deepEqual: function (actual, expected, message) {
      if (!deepEqual(actual, expected)) {
        throw new AssertionError((message ? message + ': ' : '') + 'atteso ' + fmt(expected) + ', ottenuto ' + fmt(actual));
      }
    },
    throws: function (fn, pattern, message) {
      var threw = false;
      try { fn(); } catch (e) {
        threw = true;
        if (pattern && !pattern.test(e.message)) {
          throw new AssertionError((message ? message + ': ' : '') + 'messaggio di errore inatteso: "' + e.message + '"');
        }
      }
      if (!threw) throw new AssertionError(message || 'Era atteso un errore');
    }
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function report(results) {
    var failed = results.filter(function (r) { return !r.ok; });
    var summary = (failed.length ? 'FAIL ' + failed.length : 'PASS ' + results.length) + '/' + results.length;
    if (typeof document !== 'undefined') {
      document.title = summary;
      document.body.setAttribute('data-status', failed.length ? 'fail' : 'pass');
      var out = document.getElementById('risultati') || document.body;
      var html = '<h2 class="' + (failed.length ? 'fail' : 'pass') + '">' + summary +
        (failed.length ? ' – test falliti' : ' – tutti i test superati') + '</h2><ul>';
      results.forEach(function (r) {
        html += '<li class="' + (r.ok ? 'pass' : 'fail') + '">' + (r.ok ? '✔ ' : '✘ ') +
          escapeHtml(r.group + ' › ' + r.name) + (r.ok ? '' : '<pre>' + escapeHtml(r.error) + '</pre>') + '</li>';
      });
      out.innerHTML = html + '</ul>';
    }
    if (typeof console !== 'undefined') {
      failed.forEach(function (r) { console.error('✘ ' + r.group + ' › ' + r.name + ': ' + r.error); });
      console.log(summary);
    }
    return { summary: summary, passed: results.length - failed.length, failed: failed.length, results: results };
  }

  /** Esegue tutti i test registrati (anche asincroni) e restituisce una Promise con il riepilogo. */
  function run() {
    var results = [];
    return tests.reduce(function (chain, t) {
      return chain.then(function () {
        return Promise.resolve()
          .then(function () { return t.fn(); })
          .then(function () { results.push({ group: t.group, name: t.name, ok: true }); },
            function (e) {
              results.push({ group: t.group, name: t.name, ok: false, error: (e && e.message) || String(e) });
            });
      });
    }, Promise.resolve()).then(function () { return report(results); });
  }

  root.describe = describe;
  root.it = it;
  root.assert = assert;
  root.MMTest = { run: run };
})(typeof globalThis !== 'undefined' ? globalThis : window);
