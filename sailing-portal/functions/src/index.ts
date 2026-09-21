import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import * as functionsV1 from "firebase-functions/v1";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import Anthropic from "@anthropic-ai/sdk";

initializeApp();

const db = getFirestore();
const auth = getAuth();

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

/**
 * Cleanup when an Auth user is deleted.
 * Uses v1 auth trigger (broadly supported).
 */
export const cleanupUserData = functionsV1.auth.user().onDelete(async (user) => {
  const uid = user.uid;

  await Promise.allSettled([
    db.doc(`users/${uid}`).delete(),
    db.doc(`prospies/${uid}`).delete(),
    db.doc(`stage1SailingQueue/${uid}`).delete(),
    db.doc(`stage1QuizQueue/${uid}`).delete(),
    db.doc(`stage1PersonalityQueue/${uid}`).delete(),
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


/**
 * Permanently removes a prospie: deletes their Firebase Auth account and
 * all associated Firestore records (prospie profile, user doc, queue entries).
 *
 * Deletes the Firestore records directly (rather than relying solely on the
 * cleanupUserData auth trigger) so the removal is reflected immediately.
 */
export const removeProspie = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Not signed in");
  }

  const userDoc = await db.doc(`users/${callerUid}`).get();
  const positions = (userDoc.data()?.positions as unknown[]) ?? [];
  if (!Array.isArray(positions) || !positions.includes("recruitment_chair")) {
    throw new HttpsError("permission-denied", "Not authorized");
  }

  const targetUid = request.data?.uid;
  if (typeof targetUid !== "string" || !targetUid) {
    throw new HttpsError("invalid-argument", "Missing uid.");
  }

  await Promise.allSettled([
    db.doc(`users/${targetUid}`).delete(),
    db.doc(`prospies/${targetUid}`).delete(),
    db.doc(`stage1SailingQueue/${targetUid}`).delete(),
    db.doc(`stage1QuizQueue/${targetUid}`).delete(),
    db.doc(`stage1PersonalityQueue/${targetUid}`).delete(),
  ]);

  try {
    await auth.deleteUser(targetUid);
  } catch (e: any) {
    if (e?.code !== "auth/user-not-found") {
      throw new HttpsError("internal", e?.message ?? "Failed to delete auth account.");
    }
  }

  return { success: true };
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
    .where("stage1Decision", "in", ["advance", "undecided"])
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

const PACKET_CATEGORIES = ["auto_on", "probably", "maybe", "probably_not"] as const;
type PacketCategory = (typeof PACKET_CATEGORIES)[number];

function normalizeGenderBucket(raw?: string): "men" | "women" | "other" {
  const v = (raw ?? "").trim().toLowerCase();
  if (["man", "male", "boy", "men", "guy", "guys"].includes(v)) return "men";
  if (["woman", "female", "girl", "women"].includes(v)) return "women";
  return "other";
}

/**
 * Finalizes Stage 3 voting results.
 *
 * For every prospie who appeared in a packet (stage3.packetCategory set):
 * - A manually-set finalDecision ("offer"/"drop") is respected as-is.
 * - Otherwise it's auto-resolved: "auto_on" prospies always become "offer"
 *   (they're never voted on, so a vote-count rule would wrongly drop them);
 *   everyone else becomes "offer" if their vote count meets their gender's
 *   offer threshold (settings/global.recruitment.{men,women}OfferThreshold),
 *   else "drop".
 *
 * Before changing anything, snapshots the fields the (separate, manual)
 * email step needs into stage3FinalizedProspies/{uid} — this matters because
 * an "offer" flips users/{uid}.role to "member", which triggers the existing
 * syncProspieRecordOnRoleChange cleanup and deletes prospies/{uid} shortly
 * after. "drop" prospies keep their prospies doc, marked status: "dropped".
 *
 * Idempotent: skips anyone who already has a stage3FinalizedProspies/{uid} doc.
 */
export const finalizeStage3 = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Not signed in");
  }

  const userDoc = await db.doc(`users/${callerUid}`).get();
  const positions = (userDoc.data()?.positions as unknown[]) ?? [];
  if (!Array.isArray(positions) || !positions.includes("recruitment_chair")) {
    throw new HttpsError("permission-denied", "Not authorized");
  }

  const settingsSnap = await db.doc("settings/global").get();
  const rec = settingsSnap.data()?.recruitment ?? {};
  const menThreshold = Number(rec.menOfferThreshold ?? 5);
  const womenThreshold = Number(rec.womenOfferThreshold ?? 5);

  const [prospiesSnap, votesSnap, finalizedSnap] = await Promise.all([
    db.collection("prospies").where("stage3.packetCategory", "in", PACKET_CATEGORIES).get(),
    db.collection("stage3Votes").get(),
    db.collection("stage3FinalizedProspies").get(),
  ]);

  const alreadyFinalized = new Set(finalizedSnap.docs.map((d) => d.id));

  const voteCounts = new Map<string, number>();
  votesSnap.docs.forEach((d) => {
    const data = d.data() as { menSelections?: string[]; womenSelections?: string[] };
    (data.menSelections ?? []).forEach((uid) => voteCounts.set(uid, (voteCounts.get(uid) ?? 0) + 1));
    (data.womenSelections ?? []).forEach((uid) => voteCounts.set(uid, (voteCounts.get(uid) ?? 0) + 1));
  });

  const batch = db.batch();
  let offeredCount = 0;
  let droppedCount = 0;
  let skippedCount = 0;

  for (const docSnap of prospiesSnap.docs) {
    const uid = docSnap.id;
    if (alreadyFinalized.has(uid)) {
      skippedCount++;
      continue;
    }

    const data = docSnap.data() as Record<string, any>;
    const genderBucket = normalizeGenderBucket(data.gender);
    if (genderBucket === "other") {
      // Never shown in a packet UI, so shouldn't have a packetCategory in
      // practice, but skip defensively rather than guess a threshold.
      skippedCount++;
      continue;
    }

    const category = data.stage3?.packetCategory as PacketCategory | undefined;
    const existingDecision = data.stage3?.finalDecision as string | undefined;

    const decision: "offer" | "drop" =
      existingDecision === "offer" || existingDecision === "drop"
        ? existingDecision
        : category === "auto_on"
        ? "offer"
        : (voteCounts.get(uid) ?? 0) >= (genderBucket === "men" ? menThreshold : womenThreshold)
        ? "offer"
        : "drop";

    const firstName = (data.firstName as string | undefined) ?? "";
    const lastName = (data.lastName as string | undefined) ?? "";

    let email: string | null = (data.email as string | undefined) ?? null;
    try {
      const userRecord = await auth.getUser(uid);
      email = userRecord.email ?? email;
    } catch (e) {
      console.warn(`Auth user not found for uid=${uid}. Using doc email if present.`);
    }

    batch.set(db.doc(`stage3FinalizedProspies/${uid}`), {
      firstName,
      lastName,
      email,
      decision,
      finalizedAt: FieldValue.serverTimestamp(),
      finalizedBy: callerUid,
      emailSent: false,
      emailSentAt: null,
    });

    if (decision === "offer") {
      offeredCount++;
      batch.update(db.doc(`users/${uid}`), { role: "member" });
    } else {
      droppedCount++;
      batch.update(docSnap.ref, {
        status: "dropped",
        "stage3.finalDecision": "drop",
        "stage3.finalizedAt": FieldValue.serverTimestamp(),
      });
    }
  }

  await batch.commit();

  return { offered: offeredCount, dropped: droppedCount, skipped: skippedCount };
});

/**
 * Emails every finalized-but-not-yet-emailed Stage 3 prospie their decision.
 * Deliberately a separate action from finalizeStage3 so a chair must trigger
 * it explicitly, rather than emails going out automatically the moment
 * finalization runs.
 */
export const sendStage3DecisionEmails = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Not signed in");
  }

  const userDoc = await db.doc(`users/${callerUid}`).get();
  const positions = (userDoc.data()?.positions as unknown[]) ?? [];
  if (!Array.isArray(positions) || !positions.includes("recruitment_chair")) {
    throw new HttpsError("permission-denied", "Not authorized");
  }

  const snapshot = await db
    .collection("stage3FinalizedProspies")
    .where("emailSent", "==", false)
    .get();

  const batch = db.batch();
  let offeredEmailed = 0;
  let droppedEmailed = 0;
  let skippedNoEmail = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() as {
      firstName?: string;
      email?: string | null;
      decision?: "offer" | "drop";
    };

    const firstName = data.firstName ?? "";
    const email = data.email;

    if (!email) {
      skippedNoEmail++;
      continue;
    }

    if (data.decision === "offer") {
      offeredEmailed++;
      batch.set(db.collection("mail").doc(), {
        to: email,
        message: {
          subject: "Sailing Team – Welcome to the Team!",
          text: `Hi ${firstName},

Congratulations! We're excited to welcome you to the Northwestern Sailing Team.

Please look out for a follow-up email with next steps for getting set up as a member.

– NUST Recruitment Chairs`,
        },
      });
    } else {
      droppedEmailed++;
      batch.set(db.collection("mail").doc(), {
        to: email,
        message: {
          subject: "Sailing Team Recruitment Update",
          text: `Hi ${firstName},

Thank you for your interest in the Northwestern Sailing Team and for going through our full recruitment process. Unfortunately, we won't be able to offer you a spot this time.

We truly appreciate the time and effort you put in, and we wish you the best.

– NUST Recruitment Chairs`,
        },
      });
    }

    batch.update(docSnap.ref, {
      emailSent: true,
      emailSentAt: FieldValue.serverTimestamp(),
      emailSentBy: callerUid,
    });
  }

  await batch.commit();

  return { offeredEmailed, droppedEmailed, skippedNoEmail };
});

/**
 * Generates a draft packet blurb for one prospie by synthesizing the raw
 * interviewer notes from every completed interview round (Stage 1 sailing,
 * Stage 1 personality, Stage 2) into one short paragraph.
 *
 * Does NOT write anything to Firestore — the client fills the existing
 * editable blurb textarea with the result so a chair reviews/edits it before
 * saving, same as a manually-written blurb.
 */
export const generateProspieBlurb = onCall(
  { secrets: [ANTHROPIC_API_KEY] },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError("unauthenticated", "Not signed in");
    }

    const userDoc = await db.doc(`users/${callerUid}`).get();
    const positions = (userDoc.data()?.positions as unknown[]) ?? [];
    if (!Array.isArray(positions) || !positions.includes("recruitment_chair")) {
      throw new HttpsError("permission-denied", "Not authorized");
    }

    const targetUid = request.data?.uid;
    if (typeof targetUid !== "string" || !targetUid) {
      throw new HttpsError("invalid-argument", "Missing uid.");
    }

    const prospieSnap = await db.doc(`prospies/${targetUid}`).get();
    if (!prospieSnap.exists) {
      throw new HttpsError("not-found", "Prospie not found.");
    }

    const data = prospieSnap.data() ?? {};
    const s1Sailing = data.stage1SailingInterviewSummary ?? {};
    const s1Personality = data.stage1PersonalityInterviewSummary ?? {};
    const s2 = data.stage2InterviewSummary ?? {};

    const notes: { label: string; text: string }[] = [];
    if (s1Sailing.notes1) notes.push({ label: "Stage 1 sailing interview — evaluator 1", text: s1Sailing.notes1 });
    if (s1Sailing.notes2) notes.push({ label: "Stage 1 sailing interview — evaluator 2", text: s1Sailing.notes2 });
    if (s1Personality.notes1) notes.push({ label: "Stage 1 personality interview — evaluator 1", text: s1Personality.notes1 });
    if (s1Personality.notes2) notes.push({ label: "Stage 1 personality interview — evaluator 2", text: s1Personality.notes2 });
    if (s2.notes1) notes.push({ label: "Stage 2 interview — evaluator 1", text: s2.notes1 });
    if (s2.notes2) notes.push({ label: "Stage 2 interview — evaluator 2", text: s2.notes2 });

    if (notes.length === 0) {
      throw new HttpsError("failed-precondition", "No interview notes found for this prospie yet.");
    }

    const notesBlock = notes.map((n) => `${n.label}:\n${n.text}`).join("\n\n");

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

    const response = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 1024,
      system:
        "You write short, insightful summary blurbs for a college sailing team's recruitment packet. " +
        "Given raw interviewer notes from multiple interview rounds, synthesize them into one coherent " +
        "paragraph (3-5 sentences) that captures the prospie's strengths, personality, and any concerns " +
        "raised, in a neutral, professional tone. Do not invent details that aren't present in the notes. " +
        "Do not mention numeric scores or ratings. Output only the blurb text — no headers, no preamble.",
      messages: [
        {
          role: "user",
          content: `Here are the raw interviewer notes for this prospie, across their interview rounds:\n\n${notesBlock}`,
        },
      ],
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );
    const blurb = textBlock?.text?.trim() ?? "";

    if (!blurb) {
      throw new HttpsError("internal", "Failed to generate a blurb.");
    }

    return { blurb };
  }
);
