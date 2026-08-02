import { supabase } from "./supabaseClient.js";

/* ---------------------------------------------------------
   AUTH
--------------------------------------------------------- */
export async function sendEmailOtp(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
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

export async function isStaffUser(userId) {
  const { data, error } = await supabase
    .from("staff_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return !!data;
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
    clinicPhone: row.clinic_phone || "",
  };
}

export async function fetchPatientBundle(patientId) {
  const [profileRes, audioRes, sinRes, devicesRes, apptsRes, docsRes, datalogRes] = await Promise.all([
    supabase.from("patients").select("*").eq("id", patientId).single(),
    supabase.from("audiograms").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }),
    supabase.from("sin_results").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("devices").select("*").eq("patient_id", patientId),
    supabase.from("appointments").select("*").eq("patient_id", patientId),
    supabase.from("documents").select("*").eq("patient_id", patientId),
    supabase.from("datalog").select("*").eq("patient_id", patientId).maybeSingle(),
  ]);

  return {
    profile: mapProfileRow(profileRes.data),
    audiogramHistory: (audioRes.data || []).map((a) => ({
      id: a.id, date: a.test_date, right: a.right_thresholds || [0, 0, 0, 0, 0, 0], left: a.left_thresholds || [0, 0, 0, 0, 0, 0],
    })),
    sin: sinRes.data
      ? { id: sinRes.data.id, srtDb: sinRes.data.srt_db, label: sinRes.data.label, date: sinRes.data.test_date, percentile: sinRes.data.percentile }
      : { srtDb: 0, label: "Not yet tested", date: "--", percentile: 0 },
    devices: (devicesRes.data || []).map((d) => ({
      id: d.id, ear: d.ear, model: d.model, serial: d.serial, battery: d.battery, fitted: d.fitted, warranty: d.warranty, lastService: d.last_service,
    })),
    appointments: (apptsRes.data || []).map((a) => ({
      id: a.id, type: a.type, date: a.appt_date, time: a.appt_time, clinic: a.clinic, status: a.status,
    })),
    documents: (docsRes.data || []).map((d) => ({
      id: d.id, title: d.title, category: d.category, date: d.doc_date, url: d.url,
    })),
    datalog: datalogRes.data
      ? { avgWear: datalogRes.data.avg_wear, lastSynced: datalogRes.data.last_synced }
      : { avgWear: 0, lastSynced: "Never" },
  };
}

/* ---------------------------------------------------------
   QUESTIONNAIRES (patient's own -- read + write)
--------------------------------------------------------- */
export async function fetchQuestionnaireResponses(patientId) {
  const { data } = await supabase
    .from("questionnaire_responses")
    .select("*")
    .eq("patient_id", patientId)
    .order("completed_at", { ascending: false });
  const byId = {};
  (data || []).forEach((r) => {
    if (!byId[r.questionnaire_id]) {
      byId[r.questionnaire_id] = { score: r.score, pct: r.pct, completedAt: r.completed_at, answers: r.answers };
    }
  });
  return byId;
}

export async function saveQuestionnaireResponse(patientId, questionnaireId, record) {
  const { error } = await supabase.from("questionnaire_responses").insert({
    patient_id: patientId,
    questionnaire_id: questionnaireId,
    score: record.score,
    pct: record.pct,
    completed_at: record.completedAt,
    answers: record.answers,
  });
  if (error) throw error;
}

/* ---------------------------------------------------------
   STAFF: PATIENT LIST
--------------------------------------------------------- */
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", patientId);
  if (error) throw error;
}

export async function saveAudiogramHistory(patientId, history) {
  const keepIds = history.filter((a) => isUuid(a.id)).map((a) => a.id);
  await supabase.from("audiograms").delete().eq("patient_id", patientId).not("id", "in", `(${keepIds.length ? keepIds.join(",") : "00000000-0000-0000-0000-000000000000"})`);
  for (const a of history) {
    const row = { patient_id: patientId, test_date: a.date, right_thresholds: a.right, left_thresholds: a.left };
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

export async function saveDevices(patientId, devices) {
  const keepIds = devices.filter((d) => isUuid(d.id)).map((d) => d.id);
  await supabase.from("devices").delete().eq("patient_id", patientId).not("id", "in", `(${keepIds.length ? keepIds.join(",") : "00000000-0000-0000-0000-000000000000"})`);
  for (const d of devices) {
    const row = { patient_id: patientId, ear: d.ear, model: d.model, serial: d.serial, battery: d.battery, fitted: d.fitted, warranty: d.warranty, last_service: d.lastService };
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
    const row = { patient_id: patientId, type: a.type, appt_date: a.date, appt_time: a.time, clinic: a.clinic, status: a.status };
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
