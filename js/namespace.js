/*
 * Mappe Mentali – namespace globale.
 * L'app usa script classici (non moduli ES) per funzionare anche aprendo
 * index.html con un doppio clic (protocollo file://). Tutti i moduli si
 * registrano sotto l'unico oggetto globale MM.
 */
(function (root) {
  'use strict';
  root.MM = root.MM || {};
})(typeof globalThis !== 'undefined' ? globalThis : window);
