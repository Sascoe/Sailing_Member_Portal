import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import * as functions from "firebase-functions/v1";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";

initializeApp();
const db = getFirestore();

/**
 * Cleanup when an Auth user is deleted.
 * (Uses v1 auth trigger because it's broadly supported.)
 */
export const cleanupUserData = functions.auth.user().onDelete(async (user) => {
  const uid = user.uid;

  await Promise.allSettled([
    db.doc(`users/${uid}`).delete(),
    db.doc(`prospies/${uid}`).delete(),
    db.doc(`stage1Queue/${uid}`).delete(),
  ]);
});

/**
 * Keeps `prospies/{uid}` aligned with `users/{uid}.role`.
 */
export const syncProspieRecordOnRoleChange = onDocumentUpdated(
  "users/{uid}",
  async (event) => {
    const uid = event.params.uid;

    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!before || !after) return;

    const beforeRole = before.role as string | undefined;
    const afterRole = after.role as string | undefined;

    if (beforeRole === afterRole) return;

    if (beforeRole === "prospie" && afterRole !== "prospie") {
      await db.doc(`prospies/${uid}`).delete();
    }
  }
);
