import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v1";

admin.initializeApp();

export const cleanupUserData = functions.auth.user().onDelete(async (user) => {
  const uid = user.uid;
  const db = admin.firestore();

  await Promise.allSettled([
    db.doc(`users/${uid}`).delete(),
    db.doc(`prospies/${uid}`).delete(),
    db.doc(`stage1Queue/${uid}`).delete(),
  ]);
});


