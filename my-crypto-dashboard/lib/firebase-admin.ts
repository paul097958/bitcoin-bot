import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import serviceAccount from '../../services.json' with { type: 'json' };

// 確保不會重複初始化 Firebase Admin App
export const adminApp = !getApps().length 
    ? initializeApp({
        credential: cert(serviceAccount as any),
      }) 
    : getApps()[0];

export const adminDb = getFirestore(adminApp);