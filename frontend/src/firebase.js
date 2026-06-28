import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: "mindvault-1.firebaseapp.com",
    databaseURL: "https://mindvault-1-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "mindvault-1",
    storageBucket: "mindvault-1.firebasestorage.app",
    messagingSenderId: "927591646375",
    appId: "1:927591646375:web:34c3cdbf8772ab92be8782",
    measurementId: "G-7PHBNGKBGX"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestore = getFirestore(app);
export default app;
