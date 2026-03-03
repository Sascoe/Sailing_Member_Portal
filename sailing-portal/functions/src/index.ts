import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import * as functionsV1 from "firebase-functions/v1";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";

initializeApp();

const db = getFirestore();
const auth = getAuth();

/**
 * Cleanup when an Auth user is deleted.
 * Uses v1 auth trigger (broadly supported).
 */
export const cleanupUserData = functionsV1.auth.user().onDelete(async (user) => {
  const uid = user.uid;

  await Promise.allSettled([
    db.doc(`users/${uid}`).delete(),
    db.doc(`prospies/${uid}`).delete(),
    db.doc(`stage1Queue/${uid}`).delete(),
  ]);
});

/**
 * Keeps `prospies/{uid}` aligned with `users/{uid}.role`.
 * If a user stops being a prospie, remove them from `prospies`.
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

/**
 * Finalizes Stage 1 decisions:
 * - For stage1Decision == "advance": move to Stage 2 + enqueue invite email
 * - For stage1Decision == "drop": mark dropped + enqueue rejection email
 *
 * IMPORTANT:
 * - Uses Auth as the source of truth for email
 * - Idempotent: skips if stage1FinalDecision already exists
 */
export const finalizeStage1 = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Not signed in");
  }

  // Verify recruitment chair
  const userDoc = await db.doc(`users/${callerUid}`).get();
  const positions = (userDoc.data()?.positions as unknown[]) ?? [];

  if (!Array.isArray(positions) || !positions.includes("recruitment_chair")) {
    throw new HttpsError("permission-denied", "Not authorized");
  }

  const snapshot = await db
    .collection("prospies")
    .where("stage1Complete", "==", true)
    .get();

  const batch = db.batch();

  let advancedCount = 0;
  let droppedCount = 0;
  let skippedNoEmail = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() as Record<string, any>;
    const uid = docSnap.id;

    // Idempotent guard: don't redo work / resend emails
    if (data.stage1FinalDecision) continue;

    // Source-of-truth email from Firebase Auth
    let email: string | undefined;
    try {
      const userRecord = await auth.getUser(uid);
      email = userRecord.email ?? undefined;
    } catch (e) {
      // If user no longer exists in Auth, skip safely (still can finalize if you want)
      console.warn(`Auth user not found for uid=${uid}. Skipping email.`);
      email = undefined;
    }

    const firstName = (data.firstName as string | undefined) ?? "";

    if (data.stage1Decision === "advance") {
      advancedCount++;

      batch.update(docSnap.ref, {
        stage: 2,
        status: "invited",
        stage1FinalDecision: "advance",
        stage1FinalizedAt: FieldValue.serverTimestamp(),
        stage1FinalizedBy: callerUid,
      });

      if (email) {
        batch.set(db.collection("mail").doc(), {
          to: email,
          message: {
            subject: "Sailing Team – Stage 2 Invitation",
            text: `Hi ${firstName},

Congratulations! You’ve advanced to Stage 2.

We’ll follow up with your time slot shortly.

– Sailing Team`,
          },
        });
      } else {
        skippedNoEmail++;
      }
    } else if (data.stage1Decision === "drop") {
      droppedCount++;

      batch.update(docSnap.ref, {
        status: "dropped",
        stage1FinalDecision: "drop",
        stage1FinalizedAt: FieldValue.serverTimestamp(),
        stage1FinalizedBy: callerUid,
      });

      if (email) {
        batch.set(db.collection("mail").doc(), {
          to: email,
          message: {
            subject: "Sailing Team Recruitment Update",
            text: `Hi ${firstName},

Thank you for trying out. Unfortunately we will not be moving forward this time.

We truly appreciate your effort.

– Sailing Team`,
          },
        });
      } else {
        skippedNoEmail++;
      }
    }
    // If undecided (or missing), we do nothing (no update, no email).
  }

  await batch.commit();

  return {
    advanced: advancedCount,
    dropped: droppedCount,
    skippedNoEmail,
  };
});