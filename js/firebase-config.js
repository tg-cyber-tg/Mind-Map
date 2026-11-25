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
  root.MM.firebaseConfig = {
    apiKey: 'AIzaSyC4f0AZYq8Q0QIgTQ2dtwAa9uAlWkDamVA',
    authDomain: 'mappe-mentali-d16a1.firebaseapp.com',
    projectId: 'mappe-mentali-d16a1',
    storageBucket: 'mappe-mentali-d16a1.firebasestorage.app',
    messagingSenderId: '1070530960794',
    appId: '1:1070530960794:web:04a5c0f21c81b73b77ee23'
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
