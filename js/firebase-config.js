/*
 * Mappe Mentali – configurazione Firebase (sincronizzazione Mac ↔ iPad).
 *
 * Per attivare la sincronizzazione per tutti i tuoi dispositivi senza dover
 * incollare la configurazione ogni volta, sostituisci `null` con l'oggetto
 * firebaseConfig copiato dalla console Firebase (Impostazioni progetto → Le tue app):
 *
 *   window.MM.firebaseConfig = {
 *     apiKey: "...",
 *     authDomain: "...",
 *     projectId: "...",
 *     appId: "..."
 *   };
 *
 * Le chiavi client di Firebase sono pubbliche per design: la protezione dei dati
 * è garantita da Firebase Authentication e dalle Firestore Security Rules
 * (vedi README.md per le regole pronte da incollare).
 *
 * In alternativa, lascia `null` e incolla la configurazione direttamente nella
 * finestra "Sincronizzazione" dell'app.
 */
(function (root) {
  'use strict';
  root.MM = root.MM || {};
  root.MM.firebaseConfig = null;
})(typeof globalThis !== 'undefined' ? globalThis : window);
