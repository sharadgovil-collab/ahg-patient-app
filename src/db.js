import { supabase } from "./supabaseClient.js";

const ADMIN_LOGIN_EMAIL = "staff-access@amazinghearing.com"; // internal account behind the Admin PIN
const SUPER_ADMIN_LOGIN_EMAIL = "staff-superadmin@amazinghearing.com"; // internal account behind the Super Admin PIN

/* ---------------------------------------------------------
   AUTH
--------------------------------------------------------- */
export async function sendEmailOtp(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: window.location.origin,
    },
  });
  if (error) {
    const raw = error && typeof error.message === "string" ? error.message.trim() : "";
    const readable = raw && raw !== "{}" && raw !== "[object Object]";
    throw new Error(readable ? raw : "Couldn't send the sign-in email right now. Please try again shortly or contact support.");
  }
}

export async function verifyEmailOtp(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error) throw error;
  return data.user;
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function fetchStaffRecord(userId) {
  const { data, error } = await supabase
    .from("staff_users")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  return {
    userId: data.user_id, firstName: data.first_name || "", lastName: data.last_name || "",
    clinicName: data.clinic_name || "", role: data.role || "staff",
  };
}

export async function signInStaffWithPin(pin) {
  // Try Super Admin first, then Admin -- the PIN itself determines which role logs in.
  const attempt = await supabase.auth.signInWithPassword({
    email: SUPER_ADMIN_LOGIN_EMAIL,
    password: pin,
  });
  if (!attempt.error) return attempt.data.user;

  const fallback = await supabase.auth.signInWithPassword({
    email: ADMIN_LOGIN_EMAIL,
    password: pin,
  });
  if (fallback.error) throw new Error("Incorrect PIN");
  return fallback.data.user;
}

/* ---------------------------------------------------------
   PATIENT RESOLUTION -- called right after login.
   Links a staff-precreated row (matched by email) to this
   auth user, or creates a brand-new patient row if neither
   exists.
--------------------------------------------------------- */
export async function resolveMyPatientRecord(user) {
  const { data: existing } = await supabase
    .from("patients")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (existing) return existing;

  const { data: preCreated } = await supabase
    .from("patients")
    .select("*")
    .ilike("email", user.email)
    .is("auth_user_id", null)
    .maybeSingle();

  if (preCreated) {
    const { data: linked, error } = await supabase
      .from("patients")
      .update({ auth_user_id: user.id })
      .eq("id", preCreated.id)
      .select()
      .single();
    if (error) throw error;
    return linked;
  }

  const { data: created, error } = await supabase
    .from("patients")
    .insert({ auth_user_id: user.id, email: user.email, first_name: "", last_name: "" })
    .select()
    .single();
  if (error) throw error;
  return created;
}

/* ---------------------------------------------------------
   PATIENT BUNDLE -- everything the patient-facing app needs
--------------------------------------------------------- */
export function mapProfileRow(row) {
  if (!row) return null;
  return {
    firstName: row.first_name || "", lastName: row.last_name || "", id: row.patient_code || "(not yet assigned)",
    dob: row.dob || "", gender: row.gender || "", address: row.address || "", postalCode: row.postal_code || "",
    email: row.email || "", mobile: row.mobile || "", significantOtherName: row.significant_other_name || "",
    significantOtherRelation: row.significant_other_relation || "", clinic: row.clinic || "", audiologist: row.audiologist || "",
    clinicPhone: row.clinic_phone || "", intakeCompleted: !!row.intake_completed, photoUrl: row.photo_url || "",
    salutation: row.salutation || "", nationality: row.nationality || "", spokenLanguages: row.spoken_languages || "",
    occupation: row.occupation || "", significantOtherSalutation: row.significant_other_salutation || "",
    significantOtherContact: row.significant_other_contact || "", significantOtherEmail: row.significant_other_email || "",
    referralSource: row.referral_source || "", medicalReferral: row.medical_referral,
    referralDoctorName: row.referral_doctor_name || "", consentGiven: !!row.consent_given,
    consentSignatureName: row.consent_signature_name || "",
  };
}

export async function fetchPatientBundle(patientId) {
  const [profileRes, audioRes, sinRes, cognitiveRes, devicesRes, apptsRes, docsRes, datalogRes, questionnairesRes, invoicesRes, creditNotesRes] = await Promise.all([
    supabase.from("patients").select("*").eq("id", patientId).single(),
    // Ordered by the actual test date, not when the row was entered into the system --
    // staff sometimes backfill older results after newer ones already exist, and the
    // list should always read in real chronological order regardless of entry order.
    supabase.from("audiograms").select("*").eq("patient_id", patientId).order("test_date", { ascending: false, nullsFirst: false }),
    supabase.from("sin_results").select("*").eq("patient_id", patientId).order("test_date", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    supabase.from("cognitive_results").select("*").eq("patient_id", patientId).order("test_date", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    supabase.from("devices").select("*").eq("patient_id", patientId),
    supabase.from("appointments").select("*").eq("patient_id", patientId),
    supabase.from("documents").select("*").eq("patient_id", patientId),
    supabase.from("datalog").select("*").eq("patient_id", patientId).maybeSingle(),
    supabase.from("questionnaire_responses").select("*").eq("patient_id", patientId).order("completed_at", { ascending: false }),
    supabase.from("invoices").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }),
    supabase.from("credit_notes").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }),
  ]);

  return {
    profile: mapProfileRow(profileRes.data),
    // Thresholds are stored keyed by frequency (e.g. { "500": 20, "1000": 25 }),
    // not by array position -- see the matching comment in App.jsx.
    audiogramHistory: (audioRes.data || []).map((a) => ({
      id: a.id, date: a.test_date,
      right: a.right_thresholds || {}, left: a.left_thresholds || {},
      rightACMasked: a.right_ac_masked || {}, leftACMasked: a.left_ac_masked || {},
      rightBC: a.right_bc || {}, leftBC: a.left_bc || {},
      rightBCMasked: a.right_bc_masked || {}, leftBCMasked: a.left_bc_masked || {},
    })),
    sin: sinRes.data
      ? { id: sinRes.data.id, srtDb: sinRes.data.srt_db, label: sinRes.data.label, date: sinRes.data.test_date, percentile: sinRes.data.percentile }
      : { srtDb: 0, label: "Not yet tested", date: "--", percentile: 0 },
    cognitive: cognitiveRes.data
      ? { id: cognitiveRes.data.id, testDate: cognitiveRes.data.test_date || "", score: cognitiveRes.data.score || "", interpretation: cognitiveRes.data.interpretation || "", notes: cognitiveRes.data.notes || "" }
      : { testDate: "", score: "", interpretation: "", notes: "" },
    devices: (devicesRes.data || []).map((d) => ({
      id: d.id, ear: d.ear, model: d.model, serial: d.serial, battery: d.battery, fitted: d.fitted,
      warranty: d.warranty, serviceWarranty: d.service_warranty || "", lossDamageCover: d.loss_damage_cover || "", lastService: d.last_service,
    })),
    appointments: (apptsRes.data || []).map((a) => ({
      id: a.id, type: a.type, date: a.appt_date, time: a.appt_time, clinic: a.clinic, consultant: a.consultant || "", status: a.status,
    })),
    documents: (docsRes.data || []).map((d) => ({
      id: d.id, title: d.title, category: d.category, date: d.doc_date, url: d.url, isStoragePath: !!d.is_storage_path,
    })),
    datalog: datalogRes.data
      ? { avgWear: datalogRes.data.avg_wear, lastSynced: datalogRes.data.last_synced }
      : { avgWear: 0, lastSynced: "Never" },
    questionnaires: (questionnairesRes.data || []).map((r) => ({
      id: r.id, questionnaireId: r.questionnaire_id, score: r.score, maxScore: r.max_score,
      band: r.band, bandDetail: r.band_detail, completedAt: r.completed_at, answers: r.answers,
    })),
    invoices: (invoicesRes.data || []).map((r) => ({
      id: r.id, invoiceNumber: r.invoice_number, orderJson: r.order_json, stripeSessionId: r.stripe_session_id,
      amountTotal: r.amount_total, gstAmount: r.gst_amount, subtotal: r.subtotal,
      refundedAmount: r.refunded_amount || 0, documentId: r.document_id, createdAt: r.created_at,
    })),
    creditNotes: (creditNotesRes.data || []).map((r) => ({
      id: r.id, creditNoteNumber: r.credit_note_number, invoiceId: r.invoice_id, amount: r.amount,
      gstAmount: r.gst_amount, subtotal: r.subtotal, reason: r.reason, itemsJson: r.items_json,
      stripeRefundId: r.stripe_refund_id, documentId: r.document_id, createdAt: r.created_at,
    })),
  };
}

/* ---------------------------------------------------------
   QUESTIONNAIRES (patient's own -- read + write)
--------------------------------------------------------- */
// Returns { [questionnaireId]: { current: {...}, previous: {...} | null } } so the UI
// can show the latest result and, on retake, compare it against the one before.
export async function fetchQuestionnaireResponses(patientId) {
  const { data } = await supabase
    .from("questionnaire_responses")
    .select("*")
    .eq("patient_id", patientId)
    .order("completed_at", { ascending: false });
  const toRecord = (r) => ({
    score: r.score, maxScore: r.max_score, band: r.band, bandDetail: r.band_detail,
    completedAt: r.completed_at, answers: r.answers,
  });
  const byId = {};
  (data || []).forEach((r) => {
    if (!byId[r.questionnaire_id]) byId[r.questionnaire_id] = [];
    byId[r.questionnaire_id].push(toRecord(r));
  });
  const result = {};
  Object.keys(byId).forEach((id) => {
    result[id] = { current: byId[id][0] || null, previous: byId[id][1] || null };
  });
  return result;
}

export async function saveQuestionnaireResponse(patientId, questionnaireId, record) {
  const { error } = await supabase.from("questionnaire_responses").insert({
    patient_id: patientId,
    questionnaire_id: questionnaireId,
    score: record.score,
    max_score: record.maxScore,
    band: record.band,
    band_detail: record.bandDetail,
    completed_at: record.completedAt,
    answers: record.answers,
  });
  if (error) throw error;
}

/* ---------------------------------------------------------
   PATIENT: COMPLETE INTAKE (registration form) -- called once,
   on a brand-new patient's first login.
--------------------------------------------------------- */
export async function completeIntake(patientId, draft) {
  const { error } = await supabase
    .from("patients")
    .update({
      salutation: draft.salutation,
      first_name: draft.firstName,
      last_name: draft.lastName,
      gender: draft.gender,
      dob: draft.dob,
      mobile: draft.mobile,
      nationality: draft.nationality,
      address: draft.address,
      postal_code: draft.postalCode,
      spoken_languages: draft.spokenLanguages,
      occupation: draft.occupation,
      significant_other_relation: draft.significantOtherRelation,
      significant_other_salutation: draft.significantOtherSalutation,
      significant_other_name: [draft.significantOtherFirstName, draft.significantOtherLastName].filter(Boolean).join(" "),
      significant_other_contact: draft.significantOtherContact,
      significant_other_email: draft.significantOtherEmail,
      referral_source: draft.referralSource,
      medical_referral: draft.medicalReferral,
      referral_doctor_name: draft.referralDoctorName,
      consent_given: draft.consentGiven,
      consent_signature_name: draft.consentSignatureName,
      intake_completed: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", patientId);
  if (error) throw error;
}

/* ---------------------------------------------------------
   STAFF: PATIENT LIST
--------------------------------------------------------- */
export async function touchLastActive(patientId) {
  // Fire-and-forget: records that the patient actually opened the app (not just authenticated),
  // so staff can see who has genuinely gone quiet for reactivation outreach.
  try {
    await supabase.from("patients").update({ last_active_at: new Date().toISOString() }).eq("id", patientId);
  } catch (e) {
    console.error(e);
  }
}

export async function fetchAllPatients() {
  const { data, error } = await supabase.from("patients").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createPatient({ email, firstName, lastName }) {
  const { data, error } = await supabase
    .from("patients")
    .insert({ email, first_name: firstName, last_name: lastName })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------------
   STAFF: SAVE PER-SECTION (used by the Admin Panel editor)
--------------------------------------------------------- */
export async function saveProfileFields(patientId, profile) {
  const { error } = await supabase
    .from("patients")
    .update({
      patient_code: profile.id === "(not yet assigned)" ? null : profile.id,
      first_name: profile.firstName, last_name: profile.lastName, dob: profile.dob, gender: profile.gender,
      address: profile.address, postal_code: profile.postalCode, email: profile.email, mobile: profile.mobile,
      significant_other_name: profile.significantOtherName, significant_other_relation: profile.significantOtherRelation,
      clinic: profile.clinic, audiologist: profile.audiologist, clinic_phone: profile.clinicPhone,
      intake_completed: !!profile.intakeCompleted, photo_url: profile.photoUrl || null,
      salutation: profile.salutation || null, nationality: profile.nationality || null,
      spoken_languages: profile.spokenLanguages || null, occupation: profile.occupation || null,
      significant_other_salutation: profile.significantOtherSalutation || null,
      significant_other_contact: profile.significantOtherContact || null,
      significant_other_email: profile.significantOtherEmail || null,
      referral_source: profile.referralSource || null, medical_referral: profile.medicalReferral,
      referral_doctor_name: profile.referralDoctorName || null,
      consent_given: profile.consentGiven, consent_signature_name: profile.consentSignatureName || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", patientId);
  if (error) throw error;
}

/* ---------------------------------------------------------
   PROMOTIONS -- staff-managed, shared across all patients.
   Stored in a public bucket since promo images/PDFs aren't sensitive.
--------------------------------------------------------- */
export async function fetchPromotions() {
  const { data, error } = await supabase.from("promotions").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((p) => ({
    id: p.id, title: p.title, filePath: p.file_path, fileType: p.file_type,
    expiresAt: p.expires_at, createdAt: p.created_at,
    fileUrl: supabase.storage.from("promotions").getPublicUrl(p.file_path).data.publicUrl,
  }));
}

export async function uploadPromotionFile(file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = Date.now() + "_" + safeName;
  const { error } = await supabase.storage.from("promotions").upload(path, file, { upsert: true });
  if (error) throw error;
  return path;
}

export async function createPromotion({ title, filePath, fileType, expiresAt }) {
  const { error } = await supabase.from("promotions").insert({
    title, file_path: filePath, file_type: fileType, expires_at: expiresAt || null,
  });
  if (error) throw error;
}

export async function deletePromotion(id, filePath) {
  await supabase.storage.from("promotions").remove([filePath]);
  const { error } = await supabase.from("promotions").delete().eq("id", id);
  if (error) throw error;
}

/* ---------------------------------------------------------
   PATIENT: PHOTO + FILE UPLOADS (Supabase Storage)
--------------------------------------------------------- */
// Both patient-photos and patient-documents are private buckets -- upload returns the
// storage path (not a public URL), and getSignedFileUrl() below mints a fresh,
// time-limited URL each time something actually needs to be viewed.
export async function uploadPatientFile(bucket, patientId, file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = patientId + "/" + Date.now() + "_" + safeName;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
  if (error) throw error;
  return path;
}

export async function getSignedFileUrl(bucket, path, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

// Removes every stored file for this patient (photos + documents), then deletes the
// patient row. All clinical tables (audiograms, devices, appointments, documents,
// datalog, questionnaire_responses, cognitive_results, sin_results) cascade-delete at
// the database level, so this is the one call that needs to happen. Storage isn't
// covered by that cascade, so we clear it out ourselves first, best-effort.
// Note: this does not remove the person's underlying sign-in account -- if they ever
// try to log back in, they'll simply start over as a brand-new patient.
export async function deletePatient(patientId) {
  for (const bucket of ["patient-photos", "patient-documents"]) {
    try {
      const { data: files } = await supabase.storage.from(bucket).list(patientId);
      if (files && files.length) {
        await supabase.storage.from(bucket).remove(files.map((f) => patientId + "/" + f.name));
      }
    } catch (e) { console.error("couldn't clear " + bucket + " for patient", e); }
  }
  const { error } = await supabase.from("patients").delete().eq("id", patientId);
  if (error) throw error;
}

// Invoicing happens in two steps because the invoice NUMBER (an auto-incrementing
// DB identity column, allocated atomically so two simultaneous checkouts can never
// collide) has to exist before we can print it on the PDF itself.
//
// 1) insertInvoiceRecord -- reserves the next invoice number and stores the order
//    snapshot for audit purposes.
// 2) attachInvoiceDocument -- once the PDF has been generated (now that we know the
//    invoice number), uploads it into the same private bucket patient documents use,
//    files it under the "Invoices" category so it shows up in the patient's Care >
//    Documents tab automatically, and links it back onto the invoice row.
export async function insertInvoiceRecord({ patientId, orderJson, stripeSessionId, amountTotal, gstAmount, subtotal }) {
  const { data: invoice, error } = await supabase.from("invoices").insert({
    patient_id: patientId, order_json: orderJson, stripe_session_id: stripeSessionId || null,
    amount_total: amountTotal, gst_amount: gstAmount, subtotal,
  }).select().single();
  if (error) throw error;
  return invoice;
}

export async function attachInvoiceDocument({ invoiceId, patientId, blob, fileName }) {
  const path = patientId + "/" + Date.now() + "_" + fileName;
  const { error: uploadError } = await supabase.storage.from("patient-documents").upload(path, blob, {
    upsert: true, contentType: "application/pdf",
  });
  if (uploadError) throw uploadError;

  const { data: doc, error: docError } = await supabase.from("documents").insert({
    patient_id: patientId, title: fileName, category: "Invoices",
    doc_date: new Date().toISOString().slice(0, 10), url: path, is_storage_path: true,
  }).select().single();
  if (docError) throw docError;

  const { error: updateError } = await supabase.from("invoices").update({ document_id: doc.id }).eq("id", invoiceId);
  if (updateError) throw updateError;

  return { documentId: doc.id, path };
}

// Same two-step pattern as invoices, plus a running total on the original
// invoice (refunded_amount) so the UI can always show how much of it is left
// to refund and never let staff over-refund across multiple credit notes.
export async function insertCreditNote({ patientId, invoiceId, amount, gstAmount, subtotal, reason, itemsJson, stripeRefundId }) {
  const { data: note, error } = await supabase.from("credit_notes").insert({
    patient_id: patientId, invoice_id: invoiceId, amount, gst_amount: gstAmount, subtotal,
    reason: reason || null, items_json: itemsJson, stripe_refund_id: stripeRefundId || null,
  }).select().single();
  if (error) throw error;
  return note;
}

export async function attachCreditNoteDocument({ creditNoteId, patientId, blob, fileName }) {
  const path = patientId + "/" + Date.now() + "_" + fileName;
  const { error: uploadError } = await supabase.storage.from("patient-documents").upload(path, blob, {
    upsert: true, contentType: "application/pdf",
  });
  if (uploadError) throw uploadError;

  const { data: doc, error: docError } = await supabase.from("documents").insert({
    patient_id: patientId, title: fileName, category: "Invoices",
    doc_date: new Date().toISOString().slice(0, 10), url: path, is_storage_path: true,
  }).select().single();
  if (docError) throw docError;

  const { error: updateError } = await supabase.from("credit_notes").update({ document_id: doc.id }).eq("id", creditNoteId);
  if (updateError) throw updateError;

  return { documentId: doc.id, path };
}

export async function updateInvoiceRefundedAmount(invoiceId, refundedAmount) {
  const { error } = await supabase.from("invoices").update({ refunded_amount: refundedAmount }).eq("id", invoiceId);
  if (error) throw error;
}

export async function refundViaStripe(sessionId, amount, reason) {
  const res = await fetch("/api/refund-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, amount, reason }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Refund failed");
  return data;
}

export async function savePhotoUrl(patientId, photoPath) {
  const { error } = await supabase
    .from("patients")
    .update({ photo_url: photoPath, updated_at: new Date().toISOString() })
    .eq("id", patientId);
  if (error) throw error;
}

export async function addDocument(patientId, doc) {
  const { error } = await supabase.from("documents").insert({
    patient_id: patientId, title: doc.title, category: doc.category, doc_date: doc.date,
    url: doc.url, is_storage_path: !!doc.isStoragePath,
  });
  if (error) throw error;
}

// Saves the generated registration + PDPA consent PDF into the patient's
// Documents (category "Reports") right after intake, so there's always a
// record of what they consented to and their signature on file.
export async function attachRegistrationDocument({ patientId, blob, fileName }) {
  const path = patientId + "/" + Date.now() + "_" + fileName;
  const { error: uploadError } = await supabase.storage.from("patient-documents").upload(path, blob, {
    upsert: true, contentType: "application/pdf",
  });
  if (uploadError) throw uploadError;

  const { error: docError } = await supabase.from("documents").insert({
    patient_id: patientId, title: fileName, category: "Reports",
    doc_date: new Date().toISOString().slice(0, 10), url: path, is_storage_path: true,
  });
  if (docError) throw docError;
}

export async function saveAudiogramHistory(patientId, history) {
  const keepIds = history.filter((a) => isUuid(a.id)).map((a) => a.id);
  await supabase.from("audiograms").delete().eq("patient_id", patientId).not("id", "in", `(${keepIds.length ? keepIds.join(",") : "00000000-0000-0000-0000-000000000000"})`);
  for (const a of history) {
    const row = {
      patient_id: patientId, test_date: a.date,
      right_thresholds: a.right || {}, left_thresholds: a.left || {},
      right_ac_masked: a.rightACMasked || {}, left_ac_masked: a.leftACMasked || {},
      right_bc: a.rightBC || {}, left_bc: a.leftBC || {},
      right_bc_masked: a.rightBCMasked || {}, left_bc_masked: a.leftBCMasked || {},
    };
    if (isUuid(a.id)) {
      await supabase.from("audiograms").update(row).eq("id", a.id);
    } else {
      await supabase.from("audiograms").insert(row);
    }
  }
}

export async function saveSinResult(patientId, sin) {
  const row = { patient_id: patientId, test_date: sin.date, srt_db: sin.srtDb, label: sin.label, percentile: sin.percentile };
  if (isUuid(sin.id)) {
    await supabase.from("sin_results").update(row).eq("id", sin.id);
  } else {
    await supabase.from("sin_results").insert(row);
  }
}

export async function saveCognitiveResult(patientId, cognitive) {
  const row = { patient_id: patientId, test_date: cognitive.testDate, score: cognitive.score, interpretation: cognitive.interpretation, notes: cognitive.notes };
  if (isUuid(cognitive.id)) {
    await supabase.from("cognitive_results").update(row).eq("id", cognitive.id);
  } else {
    await supabase.from("cognitive_results").insert(row);
  }
}

export async function saveDevices(patientId, devices) {
  const keepIds = devices.filter((d) => isUuid(d.id)).map((d) => d.id);
  await supabase.from("devices").delete().eq("patient_id", patientId).not("id", "in", `(${keepIds.length ? keepIds.join(",") : "00000000-0000-0000-0000-000000000000"})`);
  for (const d of devices) {
    const row = {
      patient_id: patientId, ear: d.ear, model: d.model, serial: d.serial, battery: d.battery, fitted: d.fitted,
      warranty: d.warranty, service_warranty: d.serviceWarranty, loss_damage_cover: d.lossDamageCover, last_service: d.lastService,
    };
    if (isUuid(d.id)) {
      await supabase.from("devices").update(row).eq("id", d.id);
    } else {
      await supabase.from("devices").insert(row);
    }
  }
}

export async function saveAppointments(patientId, appointments) {
  const keepIds = appointments.filter((a) => isUuid(a.id)).map((a) => a.id);
  await supabase.from("appointments").delete().eq("patient_id", patientId).not("id", "in", `(${keepIds.length ? keepIds.join(",") : "00000000-0000-0000-0000-000000000000"})`);
  for (const a of appointments) {
    const row = { patient_id: patientId, type: a.type, appt_date: a.date, appt_time: a.time, clinic: a.clinic, consultant: a.consultant, status: a.status };
    if (isUuid(a.id)) {
      await supabase.from("appointments").update(row).eq("id", a.id);
    } else {
      await supabase.from("appointments").insert(row);
    }
  }
}

export async function saveDocuments(patientId, documents) {
  const keepIds = documents.filter((d) => isUuid(d.id)).map((d) => d.id);
  await supabase.from("documents").delete().eq("patient_id", patientId).not("id", "in", `(${keepIds.length ? keepIds.join(",") : "00000000-0000-0000-0000-000000000000"})`);
  for (const d of documents) {
    const row = { patient_id: patientId, title: d.title, category: d.category, doc_date: d.date, url: d.url };
    if (isUuid(d.id)) {
      await supabase.from("documents").update(row).eq("id", d.id);
    } else {
      await supabase.from("documents").insert(row);
    }
  }
}

export async function saveDatalog(patientId, datalog) {
  const { error } = await supabase
    .from("datalog")
    .upsert({ patient_id: patientId, avg_wear: datalog.avgWear, last_synced: datalog.lastSynced });
  if (error) throw error;
}

function isUuid(val) {
  return typeof val === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}
