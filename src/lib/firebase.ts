import { initializeApp, type FirebaseApp } from "firebase/app"
import { getFirestore, type Firestore } from "firebase/firestore"

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId,
)

let firebaseApp: FirebaseApp | null = null
let firestore: Firestore | null = null

if (isFirebaseConfigured) {
  firebaseApp = initializeApp(firebaseConfig)
  firestore = getFirestore(firebaseApp)
}

export function getDb(): Firestore {
  if (!firestore) {
    throw new Error(
      "Firebase 尚未設定。請於專案根目錄建立 .env.local，填入 VITE_FIREBASE_* 變數後重新啟動開發伺服器。",
    )
  }
  return firestore
}

export { firebaseApp }
