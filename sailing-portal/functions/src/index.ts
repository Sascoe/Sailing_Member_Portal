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

    const slot = data.stage2?.slot as string | undefined;

    const slotLabelMap: Record<string, string> = {
      thu_2_4: "Thursday 2–4pm",
      thu_4_6: "Thursday 4–6pm",
      fri_2_4: "Friday 2–4pm",
      fri_4_6: "Friday 4–6pm",
    };

    const slotLabel = slot ? slotLabelMap[slot] ?? slot : "TBD";

    if (data.stage1Decision === "advance") {
      advancedCount++;

      batch.update(docSnap.ref, {
        stage: 2,
        status: "invited",
        stage1FinalDecision: "advance",
        stage1FinalizedAt: FieldValue.serverTimestamp(),
        stage1FinalizedBy: callerUid,
      });

      if (!slot) { // in case someone didn't pick a slot
        console.warn(`No slot assigned for ${uid}`);
      }

      if (email) {
        batch.set(db.collection("mail").doc(), {
          to: email,
          message: {
            subject: "Sailing Team – Stage 2 Invitation",
            text: `Hi ${firstName},

              Congratulations! You’ve advanced to Stage 2 of sailing recruitment.

              Your tryout is scheduled for:

              ${slotLabel}

              Please show up at any time during this timeslot. The on-the-water portion should take ~20 minutes with a short interview afterwards. 
              We recommend wearing athletic clothing. Your shoes WILL get wet, so please plan accordingly. We’re excited to see you on the water!

              If there are any issues regarding your assigned timeslot or if you have questions about next steps, please respond to this email ASAP so that we can figure things out. 

              – NUST Recruitment Chairs`,
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


const ALL_STAGE2_SLOTS = ["thu_2_4", "thu_4_6", "fri_2_4", "fri_4_6"] as const;
type Stage2Slot = (typeof ALL_STAGE2_SLOTS)[number];

type ProspieForAssign = {
  id: string; // uid
  availability: Stage2Slot[];
};

function isValidSlot(v: unknown): v is Stage2Slot {
  return typeof v === "string" && (ALL_STAGE2_SLOTS as readonly string[]).includes(v);
}

/**
 * Assign Stage 2 time slots for all eligible prospies.
 * Primary objective: assign a slot they selected (availability includes it).
 * Secondary objective: keep groups balanced (choose slot with lowest current count).
 *
 * Writes:
 *  - prospies/{uid}.stage2 = { slot, assignedAt, assignedBy }
 *  - prospies/{uid}.status = "invited"
 */
export const assignStageTwoSlots = onCall(async (request) => {
  // 1) Auth check
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "Not signed in");

  // 2) Authorization check (recruitment chair)
  const userDoc = await db.doc(`users/${callerUid}`).get();
  const positions = (userDoc.data()?.positions as unknown[]) ?? [];
  if (!Array.isArray(positions) || !positions.includes("recruitment_chair")) {
    throw new HttpsError("permission-denied", "Not authorized");
  }

  // 3) Optional: allow chairs to toggle which days/slots are active
  // If you don’t have this yet, the default is all slots enabled.
  const settingsSnap = await db.doc("settings/global").get();
  const enabledSlotsRaw = settingsSnap.data()?.stage2EnabledSlots;
  const enabledSlots: Stage2Slot[] = Array.isArray(enabledSlotsRaw)
    ? enabledSlotsRaw.filter(isValidSlot)
    : [...ALL_STAGE2_SLOTS];

  if (enabledSlots.length === 0) {
    throw new HttpsError("failed-precondition", "No Stage 2 slots are enabled.");
  }

  // 4) Load eligible prospies
  const snapshot = await db
    .collection("prospies")
    .where("stage1Complete", "==", true)
    .where("stage1Decision", "in", ["advanced", "undecided"])
    .get();

  // 5) Normalize prospie availability and filter invalid / missing
  const prospies: ProspieForAssign[] = snapshot.docs.map(doc => {
    const data = doc.data();

    const availability =
      (data.stage1SailingInterviewSummary?.availability ?? []) as Stage2Slot[];

    return {
      id: doc.id,
      availability
    };
  });


  // FOR TESTING 
  console.log("Total prospies fetched:", prospies.length);

  prospies.forEach(p => {
    console.log("Prospie:", p.id, "availability:", p.availability);
  });

  const validProspies = prospies.filter(p => p.availability.length > 0);
  // 6) Sort by “least availability first”
  // This is a classic constraint-satisfaction heuristic: assign the hardest cases first.
  validProspies.sort((a, b) => a.availability.length - b.availability.length);

  // 7) Initialize counts (for balancing)
  const slotCounts = new Map<Stage2Slot, number>();
  enabledSlots.forEach((s) => slotCounts.set(s, 0));

  // Track assignments and skipped reasons (useful for UI)
  const assignments = new Map<string, Stage2Slot>();
  const skippedNoAvailability: string[] = [];
  const skippedNoEnabledMatch: string[] = [];

  // 8) Greedy assignment
  for (const p of validProspies) {

      if (p.availability.length === 0) {
        skippedNoAvailability.push(p.id);
        continue;
      }

      const options = p.availability.filter((s) => enabledSlots.includes(s));

      if (options.length === 0) {
        skippedNoEnabledMatch.push(p.id);
        continue;
      }

      // Find minimum slot count
      let minCount = Infinity;

      for (const s of options) {
        const c = slotCounts.get(s) ?? 0;
        if (c < minCount) {
          minCount = c;
        }
      }

      // Collect all slots tied for minimum
     const bestSlots: Stage2Slot[] = [];
      for (const s of options) {
        const c = slotCounts.get(s) ?? 0;
        if (c === minCount) bestSlots.push(s);
      }

      // bestSlots is Stage2Slot[], so chosenSlot is Stage2Slot
      const chosenSlot = bestSlots[Math.floor(Math.random() * bestSlots.length)];

      assignments.set(p.id, chosenSlot);
      slotCounts.set(chosenSlot, (slotCounts.get(chosenSlot) ?? 0) + 1);
    }

  // 9) Persist results in a batch (one write per assigned prospie)
  const batch = db.batch();
  for (const [uid, slot] of assignments.entries()) {
    const ref = db.doc(`prospies/${uid}`);

    batch.update(ref, {
      status: "invited", // or keep current if you prefer; but invited is usually right for Stage 2
      stage: 2,
      stage2: {
        slot,
        assignedAt: FieldValue.serverTimestamp(),
        assignedBy: callerUid,
      },
    });
  }

  await batch.commit();

  // 10) Return summary for UI
  const countsObj: Record<string, number> = {};
  for (const [slot, count] of slotCounts.entries()) countsObj[slot] = count;

  return {
    enabledSlots,
    assigned: assignments.size,
    skippedNoAvailability,
    skippedNoEnabledMatch,
    slotCounts: countsObj,
  };
});
