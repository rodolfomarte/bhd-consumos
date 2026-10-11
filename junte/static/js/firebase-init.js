/* ════════════════════════════════════════════════════════════════════════
   Firebase init — shared by every page (index, live, cuenta, admin).
   Loaded after the firebase-*-compat.js <script> tags.
   ════════════════════════════════════════════════════════════════════════ */
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyD1C9QF5b2B445eN8RNWbifSwwatV-AzIY",
  authDomain:        "junte-familiar.firebaseapp.com",
  projectId:         "junte-familiar",
  storageBucket:     "junte-familiar.firebasestorage.app",
  messagingSenderId: "354317526761",
  appId:             "1:354317526761:web:10cc20d933146525343278",
};

firebase.initializeApp(FIREBASE_CONFIG);

const fbAuth    = firebase.auth();
const fbDb      = firebase.firestore();
const fbStorage = firebase.storage();
